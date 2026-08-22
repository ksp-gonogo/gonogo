import { describe, expect, it } from "vitest";
import {
  deriveEscapeVelocity,
  derivePeriod,
  deriveTrueAnomalyDeg,
} from "./body-derivations";

/**
 * What is left after mass, surface gravity and the hill sphere moved onto the
 * wire: the two values the GAME has no answer for, plus the orbital period,
 * which it does hold but computes with this exact expression.
 *
 * `deriveHillSphere`'s own case used to read "computes a·(1−e)·∛(m/3M)", which
 * is the textbook form. KSP's is a·(1−e)·(m/M)^(1/3), with no three, so the test
 * pinned a number about 31% below the game's as correct.
 */

// Kerbin's stock figures (μ, radius, orbit) for round-number sanity checks.
const KERBIN_MU = 3.5316e12;
const KERBIN_RADIUS = 600_000;
const KERBOL_MU = 1.1723328e18;
const KERBIN_SMA = 13_599_840_256;

describe("bodyDerivations", () => {
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
    it("computes 2π√(a³/μ_parent): Kerbin's year ≈ 9.2 Ms", () => {
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
