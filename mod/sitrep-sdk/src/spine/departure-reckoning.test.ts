import { describe, expect, it } from "vitest";
import type { PropagationDepartureKnot } from "../__generated__/contract";
import { value } from "../unit-system/value";
import { departureAt, meanAnomalySpread } from "./departure-reckoning";

function knot(
  untilUt: number,
  metres: number,
  metresPerSecond: number,
): PropagationDepartureKnot {
  return {
    untilUt: value("ut", untilUt),
    metres: value("m", metres),
    metresPerSecond: value("m/s", metresPerSecond),
  };
}

const KNOTS = [knot(100, 5, 0.05), knot(200, 20, 0.2)];

describe("departureAt", () => {
  const figures = (at: number) => {
    const found = departureAt(KNOTS, 0, at);
    return found && [found.metres.magnitude, found.metresPerSecond.magnitude];
  };

  it("takes the first knot whose instant is at or after the view", () => {
    expect(figures(50)).toEqual([5, 0.05]);
    expect(figures(100)).toEqual([5, 0.05]);
  });

  it("steps up to the next knot just past one, and never interpolates down", () => {
    expect(figures(100.001)).toEqual([20, 0.2]);
  });

  it("states nothing when the provider stated nothing", () => {
    expect(departureAt(null, 0, 50)).toBeUndefined();
    expect(departureAt(undefined, 0, 50)).toBeUndefined();
    expect(departureAt([], 0, 50)).toBeUndefined();
  });

  it("states nothing before the sample the envelope was measured from", () => {
    expect(departureAt(KNOTS, 10, 5)).toBeUndefined();
  });

  it("states nothing past the last knot", () => {
    expect(departureAt(KNOTS, 0, 200.5)).toBeUndefined();
  });

  it("states nothing for a knot whose figures are not finite", () => {
    expect(departureAt([knot(100, Number.NaN, 0.1)], 0, 50)).toBeUndefined();
  });
});

describe("meanAnomalySpread", () => {
  const ten = value("m", 10);
  const spreadOf = (
    sma: number,
    ecc: number,
    radius: number,
  ): number | undefined =>
    meanAnomalySpread(ten, { sma, ecc }, radius)?.magnitude;

  it("is d / a on a circular orbit", () => {
    expect(spreadOf(2_000_000, 0, 2_000_000)).toBeCloseTo(10 / 2_000_000, 15);
  });

  it("is d r / (a^2 sqrt(1 - e^2)) on an ellipse", () => {
    const sma = 2_000_000;
    const ecc = 0.9;
    const radius = 300_000;
    expect(spreadOf(sma, ecc, radius)).toBeCloseTo(
      (10 * radius) / (sma ** 2 * Math.sqrt(1 - ecc ** 2)),
      18,
    );
  });

  it("is d r / (a^2 sqrt(e^2 - 1)) on a hyperbola, whose semi-major axis is negative", () => {
    const sma = -2_000_000;
    const ecc = 1.5;
    const radius = 5_000_000;
    const spread = spreadOf(sma, ecc, radius);
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeCloseTo(
      (10 * radius) / (sma ** 2 * Math.sqrt(ecc ** 2 - 1)),
      18,
    );
  });

  it("is in radians", () => {
    expect(
      meanAnomalySpread(ten, { sma: 2_000_000, ecc: 0 }, 2_000_000)?.unit,
    ).toBe("rad");
  });

  it("has no answer for a parabola", () => {
    expect(spreadOf(2_000_000, 1, 1)).toBeUndefined();
  });
});
