import type { BodyDefinition, BodyMask } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { SCANCoverageBitmap } from "../schema";
import { SCAN_TYPE } from "../schema";
import {
  applyScanCoverageToMask,
  SCAN_BITMAP_HEIGHT,
  SCAN_BITMAP_WIDTH,
} from "./scanCoverageSync";

function emptyMask(width = 2048, height = 1024): BodyMask {
  return {
    bodyId: "kerbin",
    width,
    height,
    data: new Uint8Array(width * height),
  };
}

// Build a fork-shaped bitmap with a single tile set. ilon ranges 0..359
// (lon = ilon - 180), ilat ranges 0..179 (lat = ilat - 90). Bit index =
// ilon * height + ilat, MSB-first within each byte.
function bitmapWithTile(ilon: number, ilat: number): SCANCoverageBitmap {
  const w = SCAN_BITMAP_WIDTH;
  const h = SCAN_BITMAP_HEIGHT;
  const bits = new Uint8Array((w * h + 7) >> 3);
  const idx = ilon * h + ilat;
  bits[idx >> 3] |= 0x80 >> (idx & 7);
  let binary = "";
  for (let i = 0; i < bits.length; i++) binary += String.fromCharCode(bits[i]);
  return {
    width: w,
    height: h,
    type: SCAN_TYPE.AltimetryHiRes,
    bits: btoa(binary),
  };
}

const NO_OFFSET: Pick<BodyDefinition, "longitudeOffset" | "latitudeOffset"> = {
  longitudeOffset: 0,
  latitudeOffset: 0,
};

describe("applyScanCoverageToMask", () => {
  it("writes the prime-meridian / equator tile to the centre of a 2048×1024 mask", () => {
    // SCANsat tile (ilon=180, ilat=90) covers lon ∈ [0, 1), lat ∈ [0, 1).
    // With no axis offsets, that maps to texture pixel block centred on
    // (x=1024, y=512) — the centre of the texture.
    const mask = emptyMask();
    const changed = applyScanCoverageToMask(
      bitmapWithTile(180, 90),
      mask,
      NO_OFFSET,
    );
    expect(changed).toBe(true);
    // Pixel at (1024, 511) — just above the equator — should be lit.
    expect(mask.data[511 * mask.width + 1024]).toBe(255);
    // Pixel at (0, 0) — opposite corner — should be untouched.
    expect(mask.data[0]).toBe(0);
  });

  it("maps ilat=0 (south pole) to the bottom rows of the texture", () => {
    const mask = emptyMask();
    applyScanCoverageToMask(bitmapWithTile(180, 0), mask, NO_OFFSET);
    // ilat=0 covers lat ∈ [-90, -89); texY ∈ [((90 - -89)/180)*H,
    // ((90 - -90)/180)*H] ≈ [1018, 1024]. Pick a pixel near the bottom.
    expect(mask.data[1020 * mask.width + 1024]).toBe(255);
    // Top of texture should NOT be lit.
    expect(mask.data[5 * mask.width + 1024]).toBe(0);
  });

  it("maps ilat=179 (north pole) to the top rows of the texture", () => {
    const mask = emptyMask();
    applyScanCoverageToMask(bitmapWithTile(180, 179), mask, NO_OFFSET);
    expect(mask.data[1 * mask.width + 1024]).toBe(255);
    expect(mask.data[1023 * mask.width + 1024]).toBe(0);
  });

  it("uses max-lighten — never overwrites a higher existing value", () => {
    const mask = emptyMask();
    // Paint a single pixel at (1024, 511) full alpha by hand.
    mask.data[511 * mask.width + 1024] = 255;
    const before = mask.data[511 * mask.width + 1024];
    const changed = applyScanCoverageToMask(
      bitmapWithTile(180, 90),
      mask,
      NO_OFFSET,
    );
    // The byte was already at 255 — applyScanCoverageToMask still raises
    // *other* bytes in the same tile, so `changed` is true; the
    // specific pixel we pre-set is unchanged.
    expect(changed).toBe(true);
    expect(mask.data[511 * mask.width + 1024]).toBe(before);
  });

  it("respects longitudeOffset by shifting the painted column", () => {
    // Body with longitudeOffset = 90 (e.g. Kerbin per the existing
    // body registry). ilon=180 (physical lon=0) should map to texture
    // texLon = 0 + 90 = 90, i.e. x = ((90 + 180) / 360) * W = 0.75 W
    // = pixel column 1536.
    const mask = emptyMask();
    applyScanCoverageToMask(bitmapWithTile(180, 90), mask, {
      longitudeOffset: 90,
      latitudeOffset: 0,
    });
    // Sample around column 1536.
    expect(mask.data[511 * mask.width + 1536]).toBe(255);
    // The "no-offset" centre column should NOT be lit now.
    expect(mask.data[511 * mask.width + 1024]).toBe(0);
  });

  it("returns false for an unsupported bitmap size", () => {
    const mask = emptyMask();
    const off = applyScanCoverageToMask(
      {
        width: 256,
        height: 128,
        type: SCAN_TYPE.AltimetryHiRes,
        bits: btoa("\x80"),
      },
      mask,
      NO_OFFSET,
    );
    expect(off).toBe(false);
  });
});
