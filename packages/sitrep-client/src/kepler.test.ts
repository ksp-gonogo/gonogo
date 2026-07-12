import { describe, expect, it } from "vitest";
import { type OrbitElements, solve, solveAnomalies } from "./kepler";

const CIRCULAR: OrbitElements = {
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12, // Kerbin's GM
};

const ELLIPTICAL: OrbitElements = {
  sma: 1_000_000,
  ecc: 0.3,
  inc: 0.2,
  lan: 0.1,
  argPe: 0.4,
  meanAnomalyAtEpoch: 0.5,
  epoch: 10,
  mu: 3.5316e12,
};

describe("solveAnomalies", () => {
  it("a circular orbit has mean == eccentric == true anomaly at every ut (e ~ 0)", () => {
    const { meanAnomaly, eccentricAnomaly, trueAnomaly } = solveAnomalies(
      CIRCULAR,
      1234,
    );

    expect(eccentricAnomaly).toBeCloseTo(meanAnomaly, 12);
    expect(trueAnomaly).toBeCloseTo(meanAnomaly, 9);
  });

  it("mean motion is sqrt(mu / sma^3), independent of ut", () => {
    const n = Math.sqrt(CIRCULAR.mu / CIRCULAR.sma ** 3);

    expect(solveAnomalies(CIRCULAR, 0).meanMotion).toBeCloseTo(n, 12);
    expect(solveAnomalies(CIRCULAR, 999).meanMotion).toBeCloseTo(n, 12);
  });

  it("mean anomaly advances linearly with ut at the mean-motion rate, wrapped to [0, 2π)", () => {
    const { meanMotion } = solveAnomalies(CIRCULAR, 0);
    const at100 = solveAnomalies(CIRCULAR, 100).meanAnomaly;

    expect(at100).toBeCloseTo(meanMotion * 100, 9);
  });

  it("at meanAnomaly 0 (periapsis), eccentric and true anomaly are also 0 regardless of eccentricity", () => {
    const atEpoch = solveAnomalies(ELLIPTICAL, ELLIPTICAL.epoch);
    // meanAnomalyAtEpoch is 0.5, not 0, in ELLIPTICAL -- construct a
    // same-shape orbit whose meanAnomalyAtEpoch really is 0 to isolate the
    // periapsis case.
    const atPeriapsis = solveAnomalies(
      { ...ELLIPTICAL, meanAnomalyAtEpoch: 0 },
      ELLIPTICAL.epoch,
    );

    expect(atEpoch.meanAnomaly).toBeCloseTo(0.5, 12);
    expect(atPeriapsis.meanAnomaly).toBe(0);
    expect(atPeriapsis.eccentricAnomaly).toBe(0);
    expect(atPeriapsis.trueAnomaly).toBe(0);
  });

  it("throws for parabolic/hyperbolic eccentricities, same guard as solve()", () => {
    expect(() => solveAnomalies({ ...CIRCULAR, ecc: 1 }, 0)).toThrow(
      RangeError,
    );
    expect(() => solveAnomalies({ ...CIRCULAR, ecc: -0.1 }, 0)).toThrow(
      RangeError,
    );
  });

  it("agrees with solve()'s own internal true/eccentric anomaly for the same inputs (no drift between the two entry points)", () => {
    for (const ut of [0, 250, 5000]) {
      const anomalies = solveAnomalies(ELLIPTICAL, ut);
      const state = solve(ELLIPTICAL, ut);

      // Reconstruct the radius solve() derives from eccentricAnomaly and
      // compare against |position| -- an independent cross-check that
      // solveAnomalies' eccentricAnomaly/trueAnomaly are the exact values
      // solve() used, not a second, silently-diverged computation.
      const radiusFromAnomaly =
        ELLIPTICAL.sma *
        (1.0 - ELLIPTICAL.ecc * Math.cos(anomalies.eccentricAnomaly));
      const radiusFromPosition = Math.sqrt(
        state.position[0] ** 2 +
          state.position[1] ** 2 +
          state.position[2] ** 2,
      );

      expect(radiusFromAnomaly).toBeCloseTo(radiusFromPosition, 6);
    }
  });
});
