import {
  type OrbitPatch,
  TransitionType,
  type WireOf,
  wrapTypePayload,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  eccentricToTrueAnomaly,
  MAX_TRACK_SAMPLES,
  predictGroundTrack,
  solveKepler,
  splitOnLongitudeWrap,
  wrap180,
} from "./trajectory";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function circularEquatorial(
  overrides: Partial<WireOf<OrbitPatch>> = {},
): OrbitPatch {
  return wrapTypePayload<OrbitPatch>("OrbitPatch", {
    startUt: 0,
    endUt: 1_000_000,
    patchStartTransition: TransitionType.Initial,
    patchEndTransition: TransitionType.Final,
    peA: 1_000_000,
    apA: 1_000_000,
    inc: 0,
    ecc: 0,
    epoch: 0,
    period: 100,
    argPe: 0,
    sma: 1_000_000,
    lan: 0,
    meanAnomalyAtEpoch: 0,
    referenceBody: "Kerbin",
    semiLatusRectum: 1_000_000,
    semiMinorAxis: 1_000_000,
    closestEncounterBody: null,
    ...overrides,
  });
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
    // Asserted MODULO a revolution, which is the honest form of the identity:
    // the kernel returns E in [0, 2pi), so at negative M a solver returning E
    // in (-pi, pi] would differ by exactly one revolution and still mean the
    // same orbital position.
    // Nothing downstream can see it: every consumer uses E through cos(E) or through
    // eccentricToTrueAnomaly, both of which are periodic, and `stateAtUT` normalises
    // its reported true anomaly into [0, 360) anyway.
    const E = solveKepler(-1.0, 0.3);
    const residual = E - 0.3 * Math.sin(E) - -1.0;
    const wrapped =
      residual - 2 * Math.PI * Math.round(residual / (2 * Math.PI));
    expect(wrapped).toBeCloseTo(0, 8);
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
    // At E = π/2 (quarter into eccentric anomaly), ν should be larger than E for e > 0: the vessel has swept past more true angle.
    const e = 0.5;
    const nu = eccentricToTrueAnomaly(Math.PI / 2, e);
    expect(nu).toBeGreaterThan(Math.PI / 2);
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
      endUt: 50,
      patchEndTransition: TransitionType.Escape,
    });
    const mun = circularEquatorial({
      referenceBody: "Mun",
      startUt: 50,
      endUt: 200,
      patchStartTransition: TransitionType.Encounter,
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
    // Should only include Kerbin samples, capped at endUt=50.
    expect(out.every((s) => s.ut <= 50)).toBe(true);
    expect(out.every((s) => s.patchIndex === 0)).toBe(true);
  });

  it("respects the horizon when patches extend beyond it", () => {
    const patch = circularEquatorial({ endUt: 10_000 });
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
      ecc: 1.5,
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
    // meanAnomalyAtEpoch=π and we descend toward periapsis.
    const suborbital = circularEquatorial({
      sma: 300_000,
      ecc: 0.8,
      period: 1000,
      meanAnomalyAtEpoch: Math.PI,
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
    // We expect early termination: not the full 1000s of samples.
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(100);
    // Every emitted sample must be above the -100 m threshold.
    expect(out.every((s) => s.alt > -100)).toBe(true);
  });

  it("uses external calibrationPatches when sampling a future-only patch set", () => {
    // Simulates a maneuver preview: current orbit at ref.ut=0 is fine; the maneuver patch doesn't start until UT=100 so it can't calibrate itself.
    const currentPatch = circularEquatorial({ endUt: 200 });
    const maneuverPatch = circularEquatorial({
      startUt: 100,
      endUt: 400,
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
    const patch = circularEquatorial({ endUt: 1e10, period: 1_000_000 });
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
      { lon: 175 }, // wrap back? no, jump of 330 > 180
    ];
    const out = splitOnLongitudeWrap(samples);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
