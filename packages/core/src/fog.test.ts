import { describe, expect, it } from "vitest";
import type { BodyDefinition } from "./bodies";
import {
  type MaskTarget,
  nadirNose,
  noseFromAttitude,
  paintFogFootprint,
  paintFogFromBody,
} from "./fog";

function makeMask(w: number, h: number): MaskTarget {
  return { data: new Uint8Array(w * h), width: w, height: h };
}

function maskCoverage(mask: MaskTarget): number {
  let lit = 0;
  for (const byte of mask.data) if (byte > 0) lit++;
  return lit / mask.data.length;
}

const kerbin: BodyDefinition = {
  id: "Kerbin",
  name: "Kerbin",
  radius: 600_000,
  hasAtmosphere: true,
  maxAtmosphere: 70_000,
  longitudeOffset: 0,
  latitudeOffset: 0,
};

describe("paintFogFootprint — basic geometry", () => {
  it("returns null when altitude is zero or negative", () => {
    const mask = makeMask(64, 32);
    expect(
      paintFogFootprint(mask, {
        shipLat: 0,
        shipLon: 0,
        altitude: 0,
        nose: { x: -1, y: 0, z: 0 },
        radius: 600_000,
        fovDeg: 30,
        longitudeOffset: 0,
        latitudeOffset: 0,
        qualityAlpha: 255,
      }),
    ).toBeNull();
  });

  it("returns null when nose vector is zero", () => {
    const mask = makeMask(64, 32);
    expect(
      paintFogFootprint(mask, {
        shipLat: 0,
        shipLon: 0,
        altitude: 100_000,
        nose: { x: 0, y: 0, z: 0 },
        radius: 600_000,
        fovDeg: 30,
        longitudeOffset: 0,
        latitudeOffset: 0,
        qualityAlpha: 255,
      }),
    ).toBeNull();
  });

  it("paints a centred footprint at the sub-ship point for nadir over equator", () => {
    const mask = makeMask(256, 128);
    const rect = paintFogFootprint(mask, {
      shipLat: 0,
      shipLon: 0,
      altitude: 125_000,
      nose: nadirNose(0, 0),
      radius: 600_000,
      fovDeg: 30,
      longitudeOffset: 0,
      latitudeOffset: 0,
      qualityAlpha: 255,
    });
    expect(rect).not.toBeNull();
    // The sub-ship pixel is the centre of the map (lat 0, lon 0)
    const centreX = Math.floor(256 / 2);
    const centreY = Math.floor(128 / 2);
    const centreIdx = centreY * 256 + centreX;
    expect(mask.data[centreIdx]).toBe(255);
    // Opposite side of the planet (lon 180) must remain dark
    const oppositeX = 0;
    const oppositeIdx = centreY * 256 + oppositeX;
    expect(mask.data[oppositeIdx]).toBe(0);
  });

  it("nadir footprint width grows with altitude", () => {
    const make = (alt: number) => {
      const m = makeMask(256, 128);
      paintFogFootprint(m, {
        shipLat: 0,
        shipLon: 0,
        altitude: alt,
        nose: nadirNose(0, 0),
        radius: 600_000,
        fovDeg: 30,
        longitudeOffset: 0,
        latitudeOffset: 0,
        qualityAlpha: 255,
      });
      return maskCoverage(m);
    };
    const low = make(100_000);
    const high = make(400_000);
    expect(high).toBeGreaterThan(low);
  });

  it("nadir footprint is visibly symmetric around the sub-ship column", () => {
    const mask = makeMask(128, 64);
    paintFogFootprint(mask, {
      shipLat: 0,
      shipLon: 0,
      altitude: 200_000,
      nose: nadirNose(0, 0),
      radius: 600_000,
      fovDeg: 30,
      longitudeOffset: 0,
      latitudeOffset: 0,
      qualityAlpha: 255,
    });
    // Sub-ship point is at the pixel boundary between cols 63 and 64 when
    // W=128, so symmetry pairs are (63, 64), (62, 65), (61, 66), ...
    const W = 128;
    let left = 0;
    let right = 0;
    for (let y = 0; y < 64; y++) {
      for (let d = 0; d < 20; d++) {
        if (mask.data[y * W + (63 - d)] > 0) left++;
        if (mask.data[y * W + (64 + d)] > 0) right++;
      }
    }
    expect(left).toBe(right);
  });

  it("respects qualityAlpha and uses max-lighten semantics", () => {
    const mask = makeMask(64, 32);
    const params = {
      shipLat: 0,
      shipLon: 0,
      altitude: 125_000,
      nose: nadirNose(0, 0),
      radius: 600_000,
      fovDeg: 30,
      longitudeOffset: 0,
      latitudeOffset: 0,
    };
    paintFogFootprint(mask, { ...params, qualityAlpha: 100 });
    paintFogFootprint(mask, { ...params, qualityAlpha: 50 });
    // Centre pixel stays at the higher value
    const centreIdx = Math.floor(32 / 2) * 64 + Math.floor(64 / 2);
    expect(mask.data[centreIdx]).toBe(100);
  });

  it("handles longitude offsets by shifting the painted region", () => {
    const unshifted = makeMask(256, 128);
    const shifted = makeMask(256, 128);
    paintFogFootprint(unshifted, {
      shipLat: 0,
      shipLon: 0,
      altitude: 125_000,
      nose: nadirNose(0, 0),
      radius: 600_000,
      fovDeg: 30,
      longitudeOffset: 0,
      latitudeOffset: 0,
      qualityAlpha: 255,
    });
    paintFogFootprint(shifted, {
      shipLat: 0,
      shipLon: 0,
      altitude: 125_000,
      nose: nadirNose(0, 0),
      radius: 600_000,
      fovDeg: 30,
      longitudeOffset: 90,
      latitudeOffset: 0,
      qualityAlpha: 255,
    });
    // Lit column counts should be equal (same footprint, just translated)
    expect(maskCoverage(unshifted)).toBeCloseTo(maskCoverage(shifted), 3);
    // In the unshifted mask the centre column is lit; in the shifted mask
    // the column 90° east (width × 0.25) is lit.
    const centreY = Math.floor(128 / 2);
    expect(unshifted.data[centreY * 256 + 128]).toBe(255);
    expect(shifted.data[centreY * 256 + 128 + 64]).toBe(255);
  });
});

describe("paintFogFromBody", () => {
  it("returns null when quality is zero", () => {
    const mask = makeMask(64, 32);
    expect(
      paintFogFromBody(
        mask,
        kerbin,
        {
          lat: 0,
          lon: 0,
          altitude: 125_000,
          nose: nadirNose(0, 0),
        },
        0,
      ),
    ).toBeNull();
  });

  it("scales qualityAlpha to 0..255", () => {
    const mask = makeMask(64, 32);
    paintFogFromBody(
      mask,
      kerbin,
      { lat: 0, lon: 0, altitude: 125_000, nose: nadirNose(0, 0) },
      0.5,
    );
    const centreIdx = Math.floor(32 / 2) * 64 + Math.floor(64 / 2);
    expect(mask.data[centreIdx]).toBe(128); // round(0.5 * 255)
  });
});

describe("nadirNose", () => {
  it("points toward body centre from equator prime meridian", () => {
    const n = nadirNose(0, 0);
    expect(n.x).toBeCloseTo(-1);
    expect(n.y).toBeCloseTo(0);
    expect(n.z).toBeCloseTo(0);
  });

  it("points toward body centre from north pole", () => {
    const n = nadirNose(90, 45);
    expect(n.z).toBeCloseTo(-1);
  });
});

describe("noseFromAttitude", () => {
  it("matches nadirNose when pitch = -90", () => {
    const a = noseFromAttitude(12, -34, -90, 0);
    const b = nadirNose(12, -34);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
    expect(a.z).toBeCloseTo(b.z);
  });

  it("points radially outward at pitch = +90 regardless of heading", () => {
    const out = noseFromAttitude(30, 60, 90, 130);
    // Expected up vector at (30, 60)
    const latR = (30 * Math.PI) / 180;
    const lonR = (60 * Math.PI) / 180;
    const ex = Math.cos(latR) * Math.cos(lonR);
    const ey = Math.cos(latR) * Math.sin(lonR);
    const ez = Math.sin(latR);
    expect(out.x).toBeCloseTo(ex);
    expect(out.y).toBeCloseTo(ey);
    expect(out.z).toBeCloseTo(ez);
  });

  it("on the equator at prime meridian, heading=0 pitch=0 points north (+z)", () => {
    const n = noseFromAttitude(0, 0, 0, 0);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(0);
    expect(n.z).toBeCloseTo(1);
  });

  it("on the equator at prime meridian, heading=90 pitch=0 points east (+y)", () => {
    const n = noseFromAttitude(0, 0, 0, 90);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
    expect(n.z).toBeCloseTo(0);
  });

  it("produces a unit-length vector", () => {
    const n = noseFromAttitude(45, -22, 17, 220);
    const len = Math.hypot(n.x, n.y, n.z);
    expect(len).toBeCloseTo(1, 5);
  });

  it("warped footprint shifts in the pitch direction vs nadir", () => {
    const mask = makeMask(256, 128);
    const maskTilted = makeMask(256, 128);
    // Nadir over equator
    paintFogFootprint(mask, {
      shipLat: 0,
      shipLon: 0,
      altitude: 200_000,
      nose: noseFromAttitude(0, 0, -90, 0),
      radius: 600_000,
      fovDeg: 30,
      longitudeOffset: 0,
      latitudeOffset: 0,
      qualityAlpha: 255,
    });
    // Tilted 30° off nadir, pointing east (heading 90, pitch -60)
    paintFogFootprint(maskTilted, {
      shipLat: 0,
      shipLon: 0,
      altitude: 200_000,
      nose: noseFromAttitude(0, 0, -60, 90),
      radius: 600_000,
      fovDeg: 30,
      longitudeOffset: 0,
      latitudeOffset: 0,
      qualityAlpha: 255,
    });
    const W = 256;
    const centreY = Math.floor(128 / 2);
    // Count lit columns east vs west of the sub-ship point on the centre row
    let eastLit = 0;
    let westLit = 0;
    for (let d = 1; d <= 40; d++) {
      if (maskTilted.data[centreY * W + 128 + d] > 0) eastLit++;
      if (maskTilted.data[centreY * W + 128 - d] > 0) westLit++;
    }
    // Eastward tilt shifts coverage east
    expect(eastLit).toBeGreaterThan(westLit);
  });
});
