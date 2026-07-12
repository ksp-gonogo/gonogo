import { describe, expect, it } from "vitest";
import {
  deriveEscapeVelocity,
  deriveHillSphere,
  deriveMass,
  derivePeriod,
  deriveSurfaceGravity,
  deriveSurfaceGravityG,
  deriveTrueAnomalyDeg,
  GRAVITATIONAL_CONSTANT,
  STANDARD_GRAVITY,
} from "./bodyDerivations";

// Kerbin's stock figures (μ, radius, orbit) for round-number sanity checks.
const KERBIN_MU = 3.5316e12;
const KERBIN_RADIUS = 600_000;
const KERBOL_MU = 1.1723328e18;
const KERBIN_SMA = 13_599_840_256;

describe("bodyDerivations", () => {
  describe("deriveMass", () => {
    it("inverts μ = G·M", () => {
      expect(deriveMass(KERBIN_MU)).toBeCloseTo(
        KERBIN_MU / GRAVITATIONAL_CONSTANT,
        -10,
      );
    });
    it("returns null for missing / non-positive μ", () => {
      expect(deriveMass(null)).toBeNull();
      expect(deriveMass(undefined)).toBeNull();
      expect(deriveMass(0)).toBeNull();
      expect(deriveMass(Number.NaN)).toBeNull();
    });
  });

  describe("deriveSurfaceGravity", () => {
    it("computes μ/r² (Kerbin ≈ 9.81 m/s²)", () => {
      expect(deriveSurfaceGravity(KERBIN_MU, KERBIN_RADIUS)).toBeCloseTo(
        KERBIN_MU / (KERBIN_RADIUS * KERBIN_RADIUS),
        6,
      );
      // Kerbin is tuned to ~1 g.
      expect(deriveSurfaceGravity(KERBIN_MU, KERBIN_RADIUS)).toBeCloseTo(
        9.81,
        1,
      );
    });
    it("expresses gravity in g via deriveSurfaceGravityG", () => {
      const ms2 = deriveSurfaceGravity(KERBIN_MU, KERBIN_RADIUS) as number;
      expect(deriveSurfaceGravityG(KERBIN_MU, KERBIN_RADIUS)).toBeCloseTo(
        ms2 / STANDARD_GRAVITY,
        9,
      );
      expect(deriveSurfaceGravityG(KERBIN_MU, KERBIN_RADIUS)).toBeCloseTo(1, 2);
    });
    it("returns null when μ or radius is missing/non-positive", () => {
      expect(deriveSurfaceGravity(null, KERBIN_RADIUS)).toBeNull();
      expect(deriveSurfaceGravity(KERBIN_MU, 0)).toBeNull();
      expect(deriveSurfaceGravityG(KERBIN_MU, null)).toBeNull();
    });
  });

  describe("deriveEscapeVelocity", () => {
    it("computes √(2μ/r) (Kerbin ≈ 3431 m/s)", () => {
      expect(deriveEscapeVelocity(KERBIN_MU, KERBIN_RADIUS)).toBeCloseTo(
        Math.sqrt((2 * KERBIN_MU) / KERBIN_RADIUS),
        6,
      );
      expect(deriveEscapeVelocity(KERBIN_MU, KERBIN_RADIUS)).toBeCloseTo(
        3431.03,
        0,
      );
    });
    it("returns null for missing inputs", () => {
      expect(deriveEscapeVelocity(KERBIN_MU, null)).toBeNull();
      expect(deriveEscapeVelocity(null, KERBIN_RADIUS)).toBeNull();
    });
  });

  describe("derivePeriod", () => {
    it("computes 2π√(a³/μ_parent) — Kerbin's year ≈ 9.2 Ms", () => {
      const expected = 2 * Math.PI * Math.sqrt(KERBIN_SMA ** 3 / KERBOL_MU);
      expect(derivePeriod(KERBIN_SMA, KERBOL_MU)).toBeCloseTo(expected, 0);
      // Kerbin's stock orbital period is ~9,203,545 s.
      expect(derivePeriod(KERBIN_SMA, KERBOL_MU)).toBeGreaterThan(9_000_000);
      expect(derivePeriod(KERBIN_SMA, KERBOL_MU)).toBeLessThan(9_400_000);
    });
    it("returns null when sma or parent μ is missing", () => {
      expect(derivePeriod(null, KERBOL_MU)).toBeNull();
      expect(derivePeriod(KERBIN_SMA, null)).toBeNull();
      expect(derivePeriod(KERBIN_SMA, 0)).toBeNull();
    });
  });

  describe("deriveHillSphere", () => {
    it("computes a·(1−e)·∛(m/3M)", () => {
      const mass = deriveMass(KERBIN_MU) as number;
      const parentMass = deriveMass(KERBOL_MU) as number;
      const expected =
        KERBIN_SMA * (1 - 0) * Math.cbrt(mass / (3 * parentMass));
      expect(deriveHillSphere(KERBIN_SMA, 0, mass, parentMass)).toBeCloseTo(
        expected,
        0,
      );
    });
    it("returns null for missing inputs", () => {
      expect(deriveHillSphere(null, 0, 1, 1)).toBeNull();
      expect(deriveHillSphere(1, 0, null, 1)).toBeNull();
      expect(deriveHillSphere(1, 0, 1, null)).toBeNull();
      expect(deriveHillSphere(1, Number.NaN, 1, 1)).toBeNull();
    });
  });

  describe("deriveTrueAnomalyDeg", () => {
    it("equals the mean anomaly at epoch for a circular orbit", () => {
      // ecc = 0 → true anomaly == mean anomaly. maae = π/2 → 90°.
      expect(
        deriveTrueAnomalyDeg({
          semiMajorAxis: KERBIN_SMA,
          eccentricity: 0,
          meanAnomalyAtEpoch: Math.PI / 2,
          epoch: 0,
          parentGravParameter: KERBOL_MU,
          ut: 0,
        }),
      ).toBeCloseTo(90, 6);
    });
    it("advances with UT and wraps into [0, 360)", () => {
      const at0 = deriveTrueAnomalyDeg({
        semiMajorAxis: KERBIN_SMA,
        eccentricity: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        parentGravParameter: KERBOL_MU,
        ut: 0,
      });
      expect(at0).toBeCloseTo(0, 6);
      const later = deriveTrueAnomalyDeg({
        semiMajorAxis: KERBIN_SMA,
        eccentricity: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        parentGravParameter: KERBOL_MU,
        ut: 1_000_000,
      });
      expect(later).not.toBeNull();
      expect(later as number).toBeGreaterThanOrEqual(0);
      expect(later as number).toBeLessThan(360);
      expect(later as number).toBeGreaterThan(0);
    });
    it("returns null for hyperbolic / parabolic orbits (ecc ≥ 1)", () => {
      expect(
        deriveTrueAnomalyDeg({
          semiMajorAxis: KERBIN_SMA,
          eccentricity: 1.2,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
          parentGravParameter: KERBOL_MU,
          ut: 0,
        }),
      ).toBeNull();
    });
    it("returns null for missing orbit / UT", () => {
      const base = {
        semiMajorAxis: KERBIN_SMA,
        eccentricity: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        parentGravParameter: KERBOL_MU,
        ut: 0,
      };
      expect(deriveTrueAnomalyDeg({ ...base, ut: undefined })).toBeNull();
      expect(
        deriveTrueAnomalyDeg({ ...base, parentGravParameter: null }),
      ).toBeNull();
      expect(deriveTrueAnomalyDeg({ ...base, semiMajorAxis: null })).toBeNull();
      expect(
        deriveTrueAnomalyDeg({ ...base, meanAnomalyAtEpoch: null }),
      ).toBeNull();
    });
  });
});
