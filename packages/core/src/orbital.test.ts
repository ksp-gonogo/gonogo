import { describe, expect, it } from "vitest";
import type { BodyDefinition } from "./bodies";
import {
  circularOrbitVelocity,
  formatDistance,
  formatDuration,
  generateOrbitPoints,
  latLonToMap,
  orbitalToCartesian,
  surfaceGravity,
  trueAnomalyToRadius,
} from "./orbital";

const KERBIN: BodyDefinition = {
  id: "Kerbin",
  name: "Kerbin",
  radius: 600_000,
  gm: 3.5316e12,
  hasAtmosphere: true,
  maxAtmosphere: 70_000,
};

const MOD_BODY: BodyDefinition = {
  id: "Modtopia",
  name: "Modtopia",
  radius: 500_000,
  hasAtmosphere: false,
  maxAtmosphere: 0,
};

// ── trueAnomalyToRadius ────────────────────────────────────────────────────

describe("trueAnomalyToRadius", () => {
  it("returns SMA for a circular orbit at any angle", () => {
    const sma = 700_000;
    expect(trueAnomalyToRadius(sma, 0, 0)).toBeCloseTo(sma);
    expect(trueAnomalyToRadius(sma, 0, 90)).toBeCloseTo(sma);
    expect(trueAnomalyToRadius(sma, 0, 180)).toBeCloseTo(sma);
  });

  it("returns periapsis at θ=0", () => {
    const sma = 1_000_000;
    const ecc = 0.3;
    expect(trueAnomalyToRadius(sma, ecc, 0)).toBeCloseTo(sma * (1 - ecc));
  });

  it("returns apoapsis at θ=180", () => {
    const sma = 1_000_000;
    const ecc = 0.3;
    expect(trueAnomalyToRadius(sma, ecc, 180)).toBeCloseTo(sma * (1 + ecc));
  });

  it("is symmetric: θ and -θ give the same radius", () => {
    const r1 = trueAnomalyToRadius(1_000_000, 0.5, 60);
    const r2 = trueAnomalyToRadius(1_000_000, 0.5, -60);
    expect(r1).toBeCloseTo(r2);
  });
});

// ── orbitalToCartesian ─────────────────────────────────────────────────────

describe("orbitalToCartesian", () => {
  it("places periapsis on the +x axis (θ=0)", () => {
    const { x, y } = orbitalToCartesian(500_000, 0);
    expect(x).toBeCloseTo(500_000);
    expect(y).toBeCloseTo(0);
  });

  it("places apoapsis on the -x axis (θ=180)", () => {
    const { x, y } = orbitalToCartesian(900_000, 180);
    expect(x).toBeCloseTo(-900_000);
    expect(y).toBeCloseTo(0);
  });

  it("places θ=90 on the +y axis", () => {
    const { x, y } = orbitalToCartesian(600_000, 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(600_000);
  });
});

// ── generateOrbitPoints ────────────────────────────────────────────────────

describe("generateOrbitPoints", () => {
  it("returns the requested number of points", () => {
    const pts = generateOrbitPoints({ sma: 700_000, ecc: 0.1 }, 72);
    expect(pts).toHaveLength(72);
  });

  it("defaults to 360 samples", () => {
    expect(generateOrbitPoints({ sma: 700_000, ecc: 0 })).toHaveLength(360);
  });

  it("first point is at periapsis for a non-circular orbit", () => {
    const sma = 1_000_000;
    const ecc = 0.4;
    const pts = generateOrbitPoints({ sma, ecc }, 360);
    expect(pts[0].x).toBeCloseTo(sma * (1 - ecc));
    expect(pts[0].y).toBeCloseTo(0);
  });

  it("orbit points lie on the correct ellipse", () => {
    const sma = 1_000_000;
    const ecc = 0.3;
    const b = sma * Math.sqrt(1 - ecc * ecc);
    const c = sma * ecc; // focus-to-centre distance

    const pts = generateOrbitPoints({ sma, ecc }, 360);
    for (const { x, y } of pts) {
      // Ellipse equation: ((x+c)/a)² + (y/b)² = 1
      const check = ((x + c) / sma) ** 2 + (y / b) ** 2;
      expect(check).toBeCloseTo(1, 4);
    }
  });
});

// ── latLonToMap ────────────────────────────────────────────────────────────

describe("latLonToMap", () => {
  it("maps (0, 0) to the centre of the image", () => {
    const { x, y } = latLonToMap(0, 0, 2048, 1024);
    expect(x).toBeCloseTo(1024);
    expect(y).toBeCloseTo(512);
  });

  it("maps north pole to top edge", () => {
    expect(latLonToMap(90, 0, 2048, 1024).y).toBeCloseTo(0);
  });

  it("maps south pole to bottom edge", () => {
    expect(latLonToMap(-90, 0, 2048, 1024).y).toBeCloseTo(1024);
  });

  it("maps west edge (lon=-180) to left edge", () => {
    expect(latLonToMap(0, -180, 2048, 1024).x).toBeCloseTo(0);
  });

  it("maps east edge (lon=180) to right edge", () => {
    expect(latLonToMap(0, 180, 2048, 1024).x).toBeCloseTo(2048);
  });

  it("maps lon=90 to 3/4 of the width", () => {
    expect(latLonToMap(0, 90, 1000, 500).x).toBeCloseTo(750);
  });
});

// ── formatDuration ─────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m 05s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3 * 3600 + 14 * 60 + 8)).toBe("3h 14m 08s");
  });

  it("pads single-digit seconds", () => {
    expect(formatDuration(61)).toBe("1m 01s");
  });

  it("returns — for negative values", () => {
    expect(formatDuration(-1)).toBe("—");
  });

  it("returns — for Infinity", () => {
    expect(formatDuration(Infinity)).toBe("—");
  });
});

// ── formatDistance ─────────────────────────────────────────────────────────

describe("formatDistance", () => {
  it("formats metres", () => {
    expect(formatDistance(320)).toBe("320 m");
  });

  it("formats kilometres", () => {
    expect(formatDistance(42_350)).toBe("42.4 km");
  });

  it("formats Megametres", () => {
    expect(formatDistance(1_500_000_000)).toBe("1.50 Gm");
  });

  it("formats Terametres", () => {
    expect(formatDistance(1.5e12)).toBe("1.50 Tm");
  });

  it("returns — for Infinity", () => {
    expect(formatDistance(Infinity)).toBe("—");
  });
});

// ── circularOrbitVelocity ──────────────────────────────────────────────────

describe("circularOrbitVelocity", () => {
  it("returns ~2,287 m/s for a 75 km Kerbin orbit", () => {
    // Wiki value: ~2,287 m/s for low Kerbin orbit at 75 km.
    const v = circularOrbitVelocity(KERBIN, 75_000);
    expect(v).toBeCloseTo(2287, 0);
  });

  it("returns surface circular speed at altitude 0", () => {
    const gm = KERBIN.gm ?? 0;
    const v = circularOrbitVelocity(KERBIN, 0);
    expect(v).toBeCloseTo(Math.sqrt(gm / KERBIN.radius), 3);
  });

  it("decreases as altitude increases", () => {
    const low = circularOrbitVelocity(KERBIN, 100_000) ?? 0;
    const high = circularOrbitVelocity(KERBIN, 1_000_000) ?? 0;
    expect(high).toBeLessThan(low);
  });

  it("returns undefined when body has no gm", () => {
    expect(circularOrbitVelocity(MOD_BODY, 100_000)).toBeUndefined();
  });

  it("returns undefined for altitudes inside the body", () => {
    expect(circularOrbitVelocity(KERBIN, -700_000)).toBeUndefined();
  });
});

// ── surfaceGravity ─────────────────────────────────────────────────────────

describe("surfaceGravity", () => {
  it("returns ~9.81 m/s² at Kerbin sea level", () => {
    const g = surfaceGravity(KERBIN, 0);
    expect(g).toBeCloseTo(9.81, 1);
  });

  it("decreases with altitude", () => {
    const g0 = surfaceGravity(KERBIN, 0) ?? 0;
    const g100 = surfaceGravity(KERBIN, 100_000) ?? 0;
    expect(g100).toBeLessThan(g0);
  });

  it("returns undefined when body has no gm", () => {
    expect(surfaceGravity(MOD_BODY, 0)).toBeUndefined();
  });
});
