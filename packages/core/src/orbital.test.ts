import { describe, expect, it } from "vitest";
import type { BodyDefinition } from "./bodies";
import {
  circularOrbitVelocity,
  escapeVelocity,
  generateOrbitPoints,
  latLonToMap,
  orbitalPeriod,
  orbitalToCartesian,
  pressureAtAltitude,
  pressureFromProfile,
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
  atmosphere: { surfacePressure: 101_325, scaleHeight: 5_600 },
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

// `formatDuration` and `formatDistance` used to live here and their tests
// with them. Both are gone: a quantity is rendered by `<Unit>` now, and a
// formatter in a package every widget imports is exactly how a dashboard
// ends up with several spellings of the same unit. The geometry below is
// what this module is actually for.

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

// ── escapeVelocity ─────────────────────────────────────────────────────────

describe("escapeVelocity", () => {
  it("is √2 × circular speed at the same altitude", () => {
    const vC = circularOrbitVelocity(KERBIN, 75_000) ?? 0;
    const vE = escapeVelocity(KERBIN, 75_000) ?? 0;
    expect(vE).toBeCloseTo(vC * Math.SQRT2, 3);
  });

  it("returns ~3,431 m/s for surface escape from Kerbin", () => {
    // Wiki: ~3,431 m/s for sea-level escape (sqrt(2·GM/R)).
    const v = escapeVelocity(KERBIN, 0);
    expect(v).toBeCloseTo(3431, 0);
  });

  it("returns undefined when body has no gm", () => {
    expect(escapeVelocity(MOD_BODY, 100_000)).toBeUndefined();
  });
});

// ── orbitalPeriod ──────────────────────────────────────────────────────────

describe("orbitalPeriod", () => {
  it("matches a known low-Kerbin orbit period (~30 min at 75 km)", () => {
    // Kerbin LKO at 75 km altitude → SMA = 675 km → T ≈ 1,800 s ≈ 30 min.
    const T = orbitalPeriod(KERBIN, 675_000);
    expect(T).toBeCloseTo(1851, -1);
  });

  it("scales as a^1.5 (Kepler)", () => {
    const T1 = orbitalPeriod(KERBIN, 1_000_000) ?? 0;
    const T8 = orbitalPeriod(KERBIN, 4_000_000) ?? 0;
    // a × 4 → T × 8
    expect(T8 / T1).toBeCloseTo(8, 1);
  });

  it("returns undefined when body has no gm or sma is non-positive", () => {
    expect(orbitalPeriod(MOD_BODY, 1_000_000)).toBeUndefined();
    expect(orbitalPeriod(KERBIN, 0)).toBeUndefined();
  });
});

// ── pressureAtAltitude ─────────────────────────────────────────────────────

describe("pressureAtAltitude", () => {
  it("returns surface pressure at altitude 0", () => {
    expect(pressureAtAltitude(KERBIN, 0)).toBeCloseTo(101_325, 0);
  });

  it("falls off exponentially: down by 1/e at one scale-height", () => {
    const p = pressureAtAltitude(KERBIN, 5_600) ?? 0;
    expect(p).toBeCloseTo(101_325 / Math.E, 0);
  });

  it("returns 0 at and beyond maxAtmosphere", () => {
    expect(pressureAtAltitude(KERBIN, 70_000)).toBe(0);
    expect(pressureAtAltitude(KERBIN, 200_000)).toBe(0);
  });

  it("returns surface pressure for negative altitudes (e.g. mountain valley)", () => {
    expect(pressureAtAltitude(KERBIN, -100)).toBeCloseTo(101_325, 0);
  });

  it("returns undefined for airless bodies", () => {
    expect(pressureAtAltitude(MOD_BODY, 0)).toBeUndefined();
  });

  it("returns undefined for atmospheric bodies missing the model", () => {
    const bareAtmoBody: BodyDefinition = {
      id: "X",
      name: "X",
      radius: 500_000,
      hasAtmosphere: true,
      maxAtmosphere: 50_000,
    };
    expect(pressureAtAltitude(bareAtmoBody, 0)).toBeUndefined();
  });
});

// ── pressureFromProfile ────────────────────────────────────────────────────

describe("pressureFromProfile", () => {
  /* An exactly-exponential atmosphere, sampled coarsely and unevenly. The
     log-linear join reproduces it EXACTLY at any spacing, which is the whole
     reason for interpolating in that space, so this can assert equality
     rather than closeness. */
  const H = 5_600;
  const P0 = 101_325;
  const exponential = {
    altitudes: [0, 3_000, 11_000, 12_000, 40_000],
    pressures: [0, 3_000, 11_000, 12_000, 40_000].map(
      (h) => P0 * Math.exp(-h / H),
    ),
  };

  it("reads a sample back at its own altitude", () => {
    expect(pressureFromProfile(exponential, 11_000)).toBeCloseTo(
      P0 * Math.exp(-11_000 / H),
      6,
    );
  });

  it("reproduces an exponential atmosphere between samples, however wide the gap", () => {
    for (const h of [500, 2_999, 7_400, 11_500, 25_000, 39_999]) {
      const got = pressureFromProfile(exponential, h) ?? 0;
      expect(got / (P0 * Math.exp(-h / H))).toBeCloseTo(1, 9);
    }
  });

  it("is far closer than a linear join on the same samples", () => {
    const h = 7_400;
    const truth = P0 * Math.exp(-h / H);
    const f = (h - 3_000) / (11_000 - 3_000);
    const linear =
      exponential.pressures[1] * (1 - f) + exponential.pressures[2] * f;
    const log = pressureFromProfile(exponential, h) ?? 0;
    expect(Math.abs(log - truth)).toBeLessThan(Math.abs(linear - truth) / 100);
  });

  it("holds sea-level pressure at and below the first sample", () => {
    expect(pressureFromProfile(exponential, 0)).toBe(P0);
    expect(pressureFromProfile(exponential, -250)).toBe(P0);
  });

  it("says undefined above the last sample rather than claiming vacuum", () => {
    // The table runs out before the body's ceiling, so past its end is "not
    // stated", not "no air": zero would be a claim nothing on the wire made.
    expect(pressureFromProfile(exponential, 40_001)).toBeUndefined();
  });

  it("says undefined for an empty profile", () => {
    expect(
      pressureFromProfile({ altitudes: [], pressures: [] }, 0),
    ).toBeUndefined();
  });

  it("crosses a zero endpoint on a straight line, having no log to take", () => {
    const toVacuum = { altitudes: [0, 1_000], pressures: [100, 0] };
    expect(pressureFromProfile(toVacuum, 500)).toBeCloseTo(50, 9);
  });
});
