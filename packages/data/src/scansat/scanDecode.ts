import type {
  SCANBiomeGrid,
  SCANCoverageBitmap,
  SCANHeightGrid,
  SCANType,
} from "@gonogo/core";

/**
 * Decode helpers for the bulk SCANsat keys (scan.maskBitmap,
 * scan.heightGrid, scan.biomeGrid). All three share the same per-cell
 * grid order: row-major `(ilon, ilat)` with `ilon = (int)(lon+540)%360`
 * and `ilat = (int)(lat+270)%180`, so a single utility can walk all
 * three datasets in lockstep.
 *
 * The fork emits these with `Plotable=false` — clients fetch on body
 * change, decode once, then render from the typed arrays.
 */

export interface DecodedCoverage {
  width: number;
  height: number;
  type: SCANType;
  /** One bit per cell, MSB-first within each byte. */
  bits: Uint8Array;
}

export function decodeCoverage(
  bitmap: SCANCoverageBitmap,
): DecodedCoverage | null {
  const bits = base64ToBytes(bitmap.bits);
  if (bits.length < (bitmap.width * bitmap.height + 7) >> 3) return null;
  return {
    width: bitmap.width,
    height: bitmap.height,
    type: bitmap.type,
    bits,
  };
}

export interface DecodedHeights {
  width: number;
  height: number;
  minMetres: number;
  maxMetres: number;
  /** Metres above the body's reference radius. Length = width*height. */
  metres: Int16Array;
}

export function decodeHeightGrid(
  grid: SCANHeightGrid,
): DecodedHeights | null {
  const bytes = base64ToBytes(grid.heights);
  const expected = grid.width * grid.height * 2;
  if (bytes.length < expected) return null;
  // The fork packs little-endian. Use the byte buffer as the backing
  // store for an Int16Array — but a slice can be ArrayBuffer-aligned in
  // theory, so copy through a fresh ArrayBuffer to be safe.
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + expected,
  );
  return {
    width: grid.width,
    height: grid.height,
    minMetres: grid.minMetres,
    maxMetres: grid.maxMetres,
    metres: new Int16Array(buf),
  };
}

export interface DecodedBiomes {
  width: number;
  height: number;
  biomes: SCANBiomeGrid["biomes"];
  /** One byte per cell. 0xFF = no biome. Length = width*height. */
  indices: Uint8Array;
}

export function decodeBiomeGrid(grid: SCANBiomeGrid): DecodedBiomes | null {
  const indices = base64ToBytes(grid.indices);
  if (indices.length < grid.width * grid.height) return null;
  return {
    width: grid.width,
    height: grid.height,
    biomes: grid.biomes,
    indices,
  };
}

/**
 * Translate a (ilon, ilat) tile coordinate to a rectangular pixel range
 * on a texture-space mask of `(maskW, maskH)`. Honors the body's
 * texture offsets so the mask aligns with the rendered base texture
 * (Kerbin's prime meridian is +90° off the standard frame, etc.).
 *
 * `ilat=0` is the south-pole row in SCANsat's frame; gonogo textures
 * use `y=0` as the north pole, so the row order flips here.
 */
export interface TilePixelRect {
  /** First column inclusive. */
  x0: number;
  /** Last column exclusive (or maskW for the no-wrap case). */
  x1: number;
  /** Optional second range for tiles that wrap the antimeridian after
   *  longitudeOffset is applied. */
  x2?: number;
  x3?: number;
  /** First row inclusive (north-side). */
  y0: number;
  /** Last row exclusive (south-side). */
  y1: number;
}

export function tileToPixelRect(
  iLon: number,
  iLat: number,
  maskW: number,
  maskH: number,
  longitudeOffset = 0,
  latitudeOffset = 0,
): TilePixelRect {
  const physLonLo = iLon - 180;
  const physLatLo = iLat - 90;
  const texLonLo = wrapLon(physLonLo + longitudeOffset);
  const texLonHi = wrapLon(physLonLo + 1 + longitudeOffset);
  const texLatLo = physLatLo + latitudeOffset;
  const texLatHi = physLatLo + 1 + latitudeOffset;

  const y0 = Math.max(0, Math.floor(((90 - texLatHi) / 180) * maskH));
  const y1 = Math.min(maskH, Math.ceil(((90 - texLatLo) / 180) * maskH));

  const x0raw = ((texLonLo + 180) / 360) * maskW;
  const x1raw = ((texLonHi + 180) / 360) * maskW;
  if (x1raw > x0raw) {
    return {
      x0: Math.floor(x0raw),
      x1: Math.min(maskW, Math.ceil(x1raw)),
      y0,
      y1,
    };
  }
  // Wrap.
  return {
    x0: Math.floor(x0raw),
    x1: maskW,
    x2: 0,
    x3: Math.min(maskW, Math.ceil(x1raw)),
    y0,
    y1,
  };
}

function wrapLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== "undefined") {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const g = globalThis as unknown as {
    Buffer?: {
      from: (s: string, enc: string) => {
        [n: number]: number;
        length: number;
      };
    };
  };
  if (g.Buffer) {
    const buf = g.Buffer.from(b64, "base64");
    const out = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i];
    return out;
  }
  return new Uint8Array(0);
}
