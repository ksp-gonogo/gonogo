import { describe, expect, it } from "vitest";
import type { OrbitPatch } from "../schemas/orbit";
import {
  buildBodyRotation,
  eccentricToTrueAnomaly,
  geoFromInertial,
  MAX_TRACK_SAMPLES,
  patchStateAt,
  predictGroundTrack,
  solveKepler,
  splitOnLongitudeWrap,
  wrap180,
} from "./trajectory";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function circularEquatorial(overrides: Partial<OrbitPatch> = {}): OrbitPatch {
  return {
    startUT: 0,
    endUT: 1_000_000,
    patchStartTransition: "INITIAL",
    patchEndTransition: "FINAL",
    PeA: 1_000_000,
    ApA: 1_000_000,
    inclination: 0,
    eccentricity: 0,
    epoch: 0,
    period: 100,
    argumentOfPeriapsis: 0,
    sma: 1_000_000,
    lan: 0,
    maae: 0,
    referenceBody: "Kerbin",
    semiLatusRectum: 1_000_000,
    semiMinorAxis: 1_000_000,
    closestEncounterBody: null,
    ...overrides,
  };
}

// ── solveKepler ──────────────────────────────────────────────────────────────

describe("solveKepler", () => {
  it("returns 0 for M=0 at any eccentricity", () => {
    expect(solveKepler(0, 0)).toBeCloseTo(0, 10);
    expect(solveKepler(0, 0.5)).toBeCloseTo(0, 10);
    expect(solveKepler(0, 0.9)).toBeCloseTo(0, 10);
  });

  it("returns M for circular orbit (e=0)", () => {
    expect(solveKepler(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2, 10);
    expect(solveKepler(Math.PI / 4, 0)).toBeCloseTo(Math.PI / 4, 10);
  });

  it("satisfies E - e*sin(E) = M for elliptical orbits", () => {
    for (const e of [0.1, 0.3, 0.7, 0.9]) {
      for (const M of [0.1, 1.0, 2.5, Math.PI - 0.01]) {
        const E = solveKepler(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 8);
      }
    }
  });

  it("handles negative M (orbit in retrograde time)", () => {
    const E = solveKepler(-1.0, 0.3);
    expect(E - 0.3 * Math.sin(E)).toBeCloseTo(-1.0, 8);
  });
});

// ── eccentricToTrueAnomaly ───────────────────────────────────────────────────

describe("eccentricToTrueAnomaly", () => {
  it("agrees with E at periapsis and apoapsis (e=0)", () => {
    expect(eccentricToTrueAnomaly(0, 0)).toBeCloseTo(0, 10);
    expect(eccentricToTrueAnomaly(Math.PI, 0)).toBeCloseTo(Math.PI, 10);
  });

  it("equals E for a circular orbit at all E", () => {
    for (const E of [0.5, 1.0, 2.0, -1.5]) {
      expect(eccentricToTrueAnomaly(E, 0)).toBeCloseTo(E, 10);
    }
  });

  it("is past E past periapsis in an elliptical orbit (vessel moves faster near periapsis)", () => {
    // At E = π/2 (quarter into eccentric anomaly), ν should be larger than E
    // for e > 0 — the vessel has swept past more true angle.
    const e = 0.5;
    const nu = eccentricToTrueAnomaly(Math.PI / 2, e);
    expect(nu).toBeGreaterThan(Math.PI / 2);
  });
});

// ── patchStateAt ─────────────────────────────────────────────────────────────

describe("patchStateAt", () => {
  it("places the vessel at periapsis (+x) at epoch for a canonical orbit", () => {
    const patch = circularEquatorial({
      sma: 1_000_000,
      eccentricity: 0,
      maae: 0,
    });
    const state = patchStateAt(patch, 0);
    expect(state.x).toBeCloseTo(1_000_000, 5);
    expect(state.y).toBeCloseTo(0, 5);
    expect(state.z).toBeCloseTo(0, 5);
  });

  it("traces a quarter-orbit in a quarter-period for a circular equatorial orbit", () => {
    const patch = circularEquatorial({ sma: 1_000_000, period: 100 });
    const q = patchStateAt(patch, 25);
    expect(q.x).toBeCloseTo(0, 2);
    expect(q.y).toBeCloseTo(1_000_000, 2);
  });

  it("keeps z = 0 for zero-inclination orbits regardless of time", () => {
    const patch = circularEquatorial({ inclination: 0 });
    for (const ut of [1, 10, 50, 99]) {
      expect(patchStateAt(patch, ut).z).toBeCloseTo(0, 2);
    }
  });

  it("lifts the vessel out of the equator for an inclined orbit", () => {
    const patch = circularEquatorial({ inclination: 45 });
    // At quarter orbit, the vessel should have a non-trivial z component.
    const q = patchStateAt(patch, 25);
    expect(Math.abs(q.z)).toBeGreaterThan(100_000);
  });

  it("radius equals sma*(1 - e·cosE) for an elliptical orbit", () => {
    const patch = circularEquatorial({
      sma: 1_000_000,
      eccentricity: 0.2,
      period: 100,
    });
    const state = patchStateAt(patch, 0);
    // At epoch (M=0, so E=0), r = sma*(1 - e) = 800,000.
    expect(state.radius).toBeCloseTo(800_000, 2);
  });
});

// ── geoFromInertial ──────────────────────────────────────────────────────────

describe("geoFromInertial", () => {
  it("places (r, 0, 0) at (lat=0, lon=0)", () => {
    const geo = geoFromInertial({ x: 1_000, y: 0, z: 0, radius: 1_000 }, 500);
    expect(geo.lat).toBeCloseTo(0, 10);
    expect(geo.lonInertial).toBeCloseTo(0, 10);
    expect(geo.alt).toBeCloseTo(500, 10);
  });

  it("places (0, r, 0) at lon=90", () => {
    const geo = geoFromInertial({ x: 0, y: 1_000, z: 0, radius: 1_000 }, 0);
    expect(geo.lonInertial).toBeCloseTo(90, 10);
  });

  it("places (0, 0, r) at lat=90 (north pole)", () => {
    const geo = geoFromInertial({ x: 0, y: 0, z: 1_000, radius: 1_000 }, 0);
    expect(geo.lat).toBeCloseTo(90, 10);
  });
});

// ── wrap180 ──────────────────────────────────────────────────────────────────

describe("wrap180", () => {
  it("returns the input when already in range", () => {
    expect(wrap180(0)).toBe(0);
    expect(wrap180(90)).toBe(90);
    expect(wrap180(-90)).toBe(-90);
    expect(wrap180(180)).toBe(180);
  });

  it("wraps values above 180", () => {
    expect(wrap180(190)).toBeCloseTo(-170, 10);
    expect(wrap180(360)).toBeCloseTo(0, 10);
    expect(wrap180(540)).toBeCloseTo(180, 10);
  });

  it("wraps values below -180", () => {
    expect(wrap180(-190)).toBeCloseTo(170, 10);
    expect(wrap180(-540)).toBeCloseTo(180, 10);
  });
});

// ── buildBodyRotation ────────────────────────────────────────────────────────

describe("buildBodyRotation", () => {
  it("zero offset when body lon equals inertial lon at ref", () => {
    const patch = circularEquatorial({ maae: 0 });
    // At epoch, the vessel is at inertial lon=0. If ref.lon=0, offset is 0.
    const ref = { ut: 0, lat: 0, lon: 0 };
    const fn = buildBodyRotation(patch, ref, 100);
    expect(fn(0, 0)).toBeCloseTo(0, 5);
    expect(fn(45, 0)).toBeCloseTo(45, 5);
  });

  it("applies body rotation forward in time", () => {
    const patch = circularEquatorial({ maae: 0 });
    const ref = { ut: 0, lat: 0, lon: 0 };
    const fn = buildBodyRotation(patch, ref, 100); // 3.6 deg/s
    // After 10 s the body has rotated 36° eastward, so a feature at inertial
    // lon=0 is now at body lon=-36.
    expect(fn(0, 10)).toBeCloseTo(-36, 5);
  });
});

// ── predictGroundTrack ───────────────────────────────────────────────────────

describe("predictGroundTrack", () => {
  it("returns empty for empty patches", () => {
    const out = predictGroundTrack(
      [],
      "Kerbin",
      600_000,
      21_549,
      { ut: 0, lat: 0, lon: 0 },
      100,
      1,
    );
    expect(out).toEqual([]);
  });

  it("returns empty when no patches match the requested body", () => {
    const patch = circularEquatorial({ referenceBody: "Mun" });
    const out = predictGroundTrack(
      [patch],
      "Kerbin",
      600_000,
      21_549,
      { ut: 0, lat: 0, lon: 0 },
      100,
      1,
    );
    expect(out).toEqual([]);
  });

  it("samples a quarter-orbit cleanly", () => {
    const patch = circularEquatorial({ sma: 1_000_000, period: 100 });
    const out = predictGroundTrack(
      [patch],
      "Kerbin",
      600_000,
      1_000_000,
      { ut: 0, lat: 0, lon: 0 },
      25,
      5,
    );
    // 25s / 5s step = 6 samples including endpoints (0, 5, 10, 15, 20, 25).
    expect(out).toHaveLength(6);
    expect(out[0].ut).toBe(0);
    expect(out[out.length - 1].ut).toBe(25);
    // Altitude for a circular 1 Mm orbit with 600 km body = 400 km.
    expect(out[0].alt).toBeCloseTo(400_000, 2);
  });

  it("stops at an SOI transition (next patch has a different body)", () => {
    const kerbin = circularEquatorial({
      endUT: 50,
      patchEndTransition: "ESCAPE",
    });
    const mun = circularEquatorial({
      referenceBody: "Mun",
      startUT: 50,
      endUT: 200,
      patchStartTransition: "ENCOUNTER",
    });
    const out = predictGroundTrack(
      [kerbin, mun],
      "Kerbin",
      600_000,
      1_000_000,
      { ut: 0, lat: 0, lon: 0 },
      200,
      10,
    );
    // Should only include Kerbin samples, capped at endUT=50.
    expect(out.every((s) => s.ut <= 50)).toBe(true);
    expect(out.every((s) => s.patchIndex === 0)).toBe(true);
  });

  it("respects the horizon when patches extend beyond it", () => {
    const patch = circularEquatorial({ endUT: 10_000 });
    const out = predictGroundTrack(
      [patch],
      "Kerbin",
      600_000,
      1_000_000,
      { ut: 0, lat: 0, lon: 0 },
      100,
      10,
    );
    expect(out.every((s) => s.ut <= 100)).toBe(true);
  });

  it("skips hyperbolic patches silently (not supported in v1)", () => {
    const hyperbolic = circularEquatorial({
      eccentricity: 1.5,
      period: Number.POSITIVE_INFINITY,
    });
    const out = predictGroundTrack(
      [hyperbolic],
      "Kerbin",
      600_000,
      1_000_000,
      { ut: 0, lat: 0, lon: 0 },
      100,
      10,
    );
    expect(out).toEqual([]);
  });

  it("truncates on sub-surface dip (suborbital re-entry)", () => {
    // Body r = 200 km. Orbit sma=300 km, e=0.8 → Ap=540 km (alt 340 km, above
    // surface), Pe=60 km (alt -140 km, underground). Start at apoapsis via
    // maae=π and we descend toward periapsis.
    const suborbital = circularEquatorial({
      sma: 300_000,
      eccentricity: 0.8,
      period: 1000,
      maae: Math.PI,
    });
    const out = predictGroundTrack(
      [suborbital],
      "Kerbin",
      200_000, // body radius
      1_000_000,
      { ut: 0, lat: 0, lon: 0 },
      1000,
      10,
    );
    // We expect early termination — not the full 1000s of samples.
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(100);
    // Every emitted sample must be above the -100 m threshold.
    expect(out.every((s) => s.alt > -100)).toBe(true);
  });

  it("uses external calibrationPatches when sampling a future-only patch set", () => {
    // Simulates a maneuver preview: current orbit at ref.ut=0 is fine; the
    // maneuver patch doesn't start until UT=100 so it can't calibrate itself.
    const currentPatch = circularEquatorial({ endUT: 200 });
    const maneuverPatch = circularEquatorial({
      startUT: 100,
      endUT: 400,
      sma: 1_500_000,
      period: 200,
    });
    const out = predictGroundTrack(
      [maneuverPatch],
      "Kerbin",
      600_000,
      1_000_000,
      { ut: 0, lat: 0, lon: 0 },
      400,
      10,
      [currentPatch], // calibrationPatches
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.ut >= 100)).toBe(true);
  });

  it("caps sample count at MAX_TRACK_SAMPLES for very long horizons", () => {
    // Solar-year horizon with 1 s step would be 31.5M samples if uncapped.
    const patch = circularEquatorial({ endUT: 1e10, period: 1_000_000 });
    const out = predictGroundTrack(
      [patch],
      "Kerbin",
      600_000,
      1_000_000,
      { ut: 0, lat: 0, lon: 0 },
      31_536_000, // one Kerbin year-ish
      1,
    );
    expect(out.length).toBeLessThanOrEqual(MAX_TRACK_SAMPLES + 1);
  });
});

// ── splitOnLongitudeWrap ─────────────────────────────────────────────────────

describe("splitOnLongitudeWrap", () => {
  it("returns empty for empty input", () => {
    expect(splitOnLongitudeWrap([])).toEqual([]);
  });

  it("keeps everything in one segment when no wrap occurs", () => {
    const samples = [{ lon: 0 }, { lon: 10 }, { lon: 20 }, { lon: 30 }];
    expect(splitOnLongitudeWrap(samples)).toEqual([samples]);
  });

  it("splits at a date-line crossing", () => {
    const samples = [{ lon: 170 }, { lon: 175 }, { lon: -175 }, { lon: -170 }];
    const out = splitOnLongitudeWrap(samples);
    expect(out).toHaveLength(2);
    expect(out[0].map((s) => s.lon)).toEqual([170, 175]);
    expect(out[1].map((s) => s.lon)).toEqual([-175, -170]);
  });

  it("handles multiple wraps across a long prediction", () => {
    const samples = [
      { lon: 170 },
      { lon: -175 }, // wrap
      { lon: -170 },
      { lon: -160 },
      { lon: 170 },
      { lon: 175 }, // wrap back? no — jump of 330 > 180
    ];
    const out = splitOnLongitudeWrap(samples);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
