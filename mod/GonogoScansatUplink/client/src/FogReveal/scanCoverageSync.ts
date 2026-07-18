import type { BodyDefinition } from "@ksp-gonogo/core";
import type { BodyMask } from "@ksp-gonogo/data";
import type { SCANCoverageBitmap, SCANType } from "../schema";
import { SCAN_TYPE } from "../schema";

/** Wrap a longitude into the [-180, 180) range. */
function wrapLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/**
 * Defaults the SCANsat→fog-mask sync uses. Exported for tests + harness
 * inspection. `BITMAP_WIDTH` × `BITMAP_HEIGHT` matches SCANsat's own
 * `Coverage` array dimensions; the fork emits at these dimensions
 * verbatim.
 */
export const SCAN_BITMAP_WIDTH = 360;
export const SCAN_BITMAP_HEIGHT = 180;
export const DEFAULT_SCAN_TYPE: SCANType = SCAN_TYPE.AltimetryHiRes;

/**
 * Decode a SCANsat coverage bitmap (1°×1° tile bits, base64-packed) and
 * upsample it into a `BodyMask`'s alpha bytes (typically 2048×1024).
 * Writes use max-lighten so existing painter writes survive — the fog
 * cache treats the bytes as "highest imaging quality reached so far".
 *
 * Returns true when any byte was newly raised (caller should call
 * `cache.markDirty(bodyId)`), false when the mask already had at least
 * that much coverage.
 *
 * The body's `longitudeOffset` / `latitudeOffset` are applied so SCANsat's
 * physical lat/lon maps to the texture-space pixel grid the painter
 * uses. SCANsat indexes `ilat=0` as the south pole row; the gonogo
 * texture uses `y=0` as the north pole row, so the row order flips
 * during the upsample.
 */
export function applyScanCoverageToMask(
  bitmap: SCANCoverageBitmap,
  mask: BodyMask,
  body: Pick<BodyDefinition, "longitudeOffset" | "latitudeOffset">,
): boolean {
  if (
    bitmap.width !== SCAN_BITMAP_WIDTH ||
    bitmap.height !== SCAN_BITMAP_HEIGHT
  ) {
    // Defensive: the fork emits 360×180. A mismatch would mean a
    // wire-shape change; rather than guess at the new layout, bail.
    return false;
  }
  const bits = base64ToBytes(bitmap.bits);
  if (bits.length < (bitmap.width * bitmap.height + 7) >> 3) return false;

  const lonOff = body.longitudeOffset ?? 0;
  const latOff = body.latitudeOffset ?? 0;
  const maskW = mask.width;
  const maskH = mask.height;

  let changed = false;
  // Iterate each SCANsat tile, set the corresponding pixel block when
  // its bit is set. With 2048×1024 mask + 360×180 SCAN grid that's
  // ~5.69×5.69 pixels per tile — cheap, ~65K iterations.
  for (let iLon = 0; iLon < bitmap.width; iLon++) {
    for (let iLat = 0; iLat < bitmap.height; iLat++) {
      const bitIdx = iLon * bitmap.height + iLat;
      const byte = bits[bitIdx >> 3];
      if ((byte & (0x80 >> (bitIdx & 7))) === 0) continue;

      // Tile occupies physical lon ∈ [iLon-180, iLon-179), lat ∈
      // [iLat-90, iLat-89). Convert to texture pixel ranges.
      const physLonLo = iLon - 180;
      const physLatLo = iLat - 90;
      const texLonLo = wrapLon(physLonLo + lonOff);
      const texLonHi = wrapLon(physLonLo + 1 + lonOff);
      const texLatLo = physLatLo + latOff;
      const texLatHi = physLatLo + 1 + latOff;

      // texY: y=0 is north pole, so latitude maps inversely.
      const y0 = Math.max(0, Math.floor(((90 - texLatHi) / 180) * maskH));
      const y1 = Math.min(maskH, Math.ceil(((90 - texLatLo) / 180) * maskH));

      // texX: simple linear, but tile may wrap the antimeridian after
      // longitudeOffset is applied. Two-segment paint covers it.
      const xRanges = pixelXRanges(texLonLo, texLonHi, maskW);
      for (const [x0, x1] of xRanges) {
        for (let y = y0; y < y1; y++) {
          const rowOffset = y * maskW;
          for (let x = x0; x < x1; x++) {
            if (mask.data[rowOffset + x] < 255) {
              mask.data[rowOffset + x] = 255;
              changed = true;
            }
          }
        }
      }
    }
  }
  return changed;
}

/**
 * Convert a [lonLo, lonHi) span (degrees in [-180, 180), possibly
 * wrapping the antimeridian) to one or two `[x0, x1)` pixel ranges.
 */
function pixelXRanges(
  lonLo: number,
  lonHi: number,
  maskW: number,
): readonly [number, number][] {
  const x0 = ((lonLo + 180) / 360) * maskW;
  const x1 = ((lonHi + 180) / 360) * maskW;
  if (x1 > x0) {
    return [[Math.floor(x0), Math.min(maskW, Math.ceil(x1))]];
  }
  // Wrap: paint [x0, W) and [0, x1).
  return [
    [Math.floor(x0), maskW],
    [0, Math.min(maskW, Math.ceil(x1))],
  ];
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== "undefined") {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // Node fallback for tests / SSR — Buffer is available in the harness.
  const g = globalThis as unknown as {
    Buffer?: {
      from: (s: string, enc: string) => { [n: number]: number; length: number };
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
