import { inflateSync } from "node:zlib";

/**
 * A PNG reader, in about sixty lines, because the alternative was a dependency.
 *
 * The GIF encoder needs RGBA pixels and Playwright hands back PNG bytes, so
 * something has to decode them. `pngjs` is CJS and reaches for `util` through a
 * `require`, which an ESM bundle answers with "Dynamic require of util is not
 * supported" on its first frame; making it a real dependency would put the first
 * runtime dependency on a design-system package whose whole manifest premise is
 * that it has none. `zlib` is a Node builtin and the rest is arithmetic.
 *
 * Deliberately narrow: 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA),
 * which is what every engine's screenshot is. Anything else throws by name
 * rather than being decoded wrongly into a plausible picture.
 */

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(bytes: Buffer): DecodedPng {
  for (const [i, expected] of SIGNATURE.entries()) {
    if (bytes[i] !== expected) throw new Error("decodePng: not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colourType = body[9];
      const interlace = body[12];
      if (
        depth !== 8 ||
        interlace !== 0 ||
        (colourType !== 6 && colourType !== 2)
      ) {
        throw new Error(
          `decodePng: only 8-bit non-interlaced RGB/RGBA is supported, got ` +
            `depth ${depth}, colour type ${colourType}, interlace ${interlace}`,
        );
      }
      channels = colourType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
  }
  if (width === 0 || height === 0 || channels === 0) {
    throw new Error("decodePng: no IHDR");
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++];
    for (let x = 0; x < stride; x++) {
      const value = raw[cursor + x];
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      line[x] = unfilter(filter, value, left, up, upLeft);
    }
    cursor += stride;
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      out[dst] = line[src];
      out[dst + 1] = line[src + 1];
      out[dst + 2] = line[src + 2];
      out[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }
    previous.set(line);
  }
  return { width, height, data: out };
}

/** The five PNG line filters (RFC 2083 section 6). */
function unfilter(
  filter: number,
  value: number,
  left: number,
  up: number,
  upLeft: number,
): number {
  switch (filter) {
    case 0:
      return value;
    case 1:
      return (value + left) & 0xff;
    case 2:
      return (value + up) & 0xff;
    case 3:
      return (value + ((left + up) >> 1)) & 0xff;
    case 4:
      return (value + paeth(left, up, upLeft)) & 0xff;
    default:
      throw new Error(`decodePng: unknown line filter ${filter}`);
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
