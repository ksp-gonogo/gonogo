import { describe, expect, it } from "vitest";
import { value } from "../unit-system/value";
import {
  meanAnomalyAt,
  type OrbitElements,
  solveAnomalies,
  solveConic,
} from "./kepler";

const MU = 3.5316e12;

const ELEMENTS: OrbitElements = {
  sma: 1_250_000,
  ecc: 0.45,
  inc: 0.3,
  lan: 1.1,
  argPe: 2.2,
  meanAnomalyAtEpoch: 5.9,
  epoch: 100,
  mu: MU,
};

function conicOf(orbit: OrbitElements) {
  return {
    sma: value("m", orbit.sma),
    ecc: value("1", orbit.ecc),
    meanAnomalyAtEpoch: value("rad", orbit.meanAnomalyAtEpoch),
    epoch: value("ut", orbit.epoch),
  };
}

describe("solveConic", () => {
  it("agrees with solveAnomalies when the mean motion is derived from mu", () => {
    const n = Math.sqrt(MU / ELEMENTS.sma ** 3);
    for (const ut of [-5000, 100, 4321.5, 9_000_000]) {
      const want = solveAnomalies(ELEMENTS, ut);
      const got = solveConic(
        conicOf(ELEMENTS),
        value("rad·s⁻¹", n),
        value("ut", ut),
      );
      expect(got.meanAnomaly).toBe(want.meanAnomaly);
      expect(got.eccentricAnomaly).toBe(want.eccentricAnomaly);
      expect(got.trueAnomaly).toBe(want.trueAnomaly);
      expect(got.radius).toBeCloseTo(
        ELEMENTS.sma * (1 - ELEMENTS.ecc * Math.cos(want.eccentricAnomaly)),
        6,
      );
    }
  });

  it("advances at the mean motion it is handed, not one derived from the shape", () => {
    const slow = solveConic(
      conicOf(ELEMENTS),
      value("rad·s⁻¹", 1e-4),
      value("ut", 1100),
    );
    const fast = solveConic(
      conicOf(ELEMENTS),
      value("rad·s⁻¹", 2e-4),
      value("ut", 1100),
    );
    expect(fast.meanAnomaly).not.toBe(slow.meanAnomaly);
    expect(slow.meanAnomaly).toBeCloseTo(
      (5.9 + 1e-4 * 1000) % (2 * Math.PI),
      12,
    );
  });

  it("refuses an unbound shape rather than answering", () => {
    const hyperbolic = { ...conicOf(ELEMENTS), ecc: value("1", 1.2) };
    expect(() =>
      solveConic(hyperbolic, value("rad·s⁻¹", 1e-4), value("ut", 200)),
    ).toThrow(RangeError);
  });

  it("owns the mean-anomaly advance", () => {
    expect(
      meanAnomalyAt(
        value("rad", 1),
        value("rad·s⁻¹", 0.01),
        value("ut", 10),
        value("ut", 110),
      ),
    ).toBe(2);
  });
});
