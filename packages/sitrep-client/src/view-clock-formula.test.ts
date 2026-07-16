import { describe, expect, it } from "vitest";
import {
  type ClockFormulaInputs,
  computeConfirmedEdgeUt,
  computeUtNowEstimate,
} from "./view-clock-formula";

describe("computeUtNowEstimate", () => {
  it("returns 0 before any anchor and any sample (cold start)", () => {
    const inputs: ClockFormulaInputs = {
      maxSampleUt: Number.NEGATIVE_INFINITY,
      delaySeconds: 0,
      warpRate: 1,
      slackSeconds: 0,
    };
    expect(computeUtNowEstimate(inputs, 0)).toBe(0);
  });

  it("returns maxSampleUt before any anchor but after at least one sample", () => {
    const inputs: ClockFormulaInputs = {
      maxSampleUt: 42,
      delaySeconds: 0,
      warpRate: 1,
      slackSeconds: 0,
    };
    expect(computeUtNowEstimate(inputs, 100)).toBe(42);
  });

  it("extrapolates from the anchor at warpRate x wall-elapsed", () => {
    const inputs: ClockFormulaInputs = {
      anchorWall: 10,
      anchorUt: 1000,
      maxSampleUt: 1000,
      delaySeconds: 0,
      warpRate: 50,
      slackSeconds: 0,
    };
    // 2 wall-seconds elapsed at 50x -> +100 UT
    expect(computeUtNowEstimate(inputs, 12)).toBe(1100);
  });
});

describe("computeConfirmedEdgeUt", () => {
  it("returns -Infinity before any sample has ever been observed", () => {
    const inputs: ClockFormulaInputs = {
      maxSampleUt: Number.NEGATIVE_INFINITY,
      delaySeconds: 0,
      warpRate: 1,
      slackSeconds: 0,
    };
    expect(computeConfirmedEdgeUt(inputs, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("sample-limited regime: clamps to maxSampleUt + slack, ignoring a runaway estimate", () => {
    const inputs: ClockFormulaInputs = {
      anchorWall: 0,
      anchorUt: 10,
      maxSampleUt: 10,
      delaySeconds: 0,
      warpRate: 100, // aggressive slope
      slackSeconds: 0,
    };
    // Raw estimate at wall=5 would be 10 + 5*100 = 510, but only UT 10 has
    // ever actually been confirmed.
    expect(computeUtNowEstimate(inputs, 5)).toBeGreaterThan(500);
    expect(computeConfirmedEdgeUt(inputs, 5)).toBe(10);
  });

  it("delay-limited regime: the estimate minus delaySeconds binds, well under the sample clamp", () => {
    const inputs: ClockFormulaInputs = {
      anchorWall: 0,
      anchorUt: 100,
      maxSampleUt: 100,
      delaySeconds: 20,
      warpRate: 1,
      slackSeconds: 0,
    };
    // estimate(1) = 101; edge = 101 - 20 = 81, well under the clamp (100).
    expect(computeConfirmedEdgeUt(inputs, 1)).toBe(81);
  });

  it("slackSeconds widens the sample-clamp side of the min()", () => {
    const inputs: ClockFormulaInputs = {
      anchorWall: 0,
      anchorUt: 10,
      maxSampleUt: 10,
      delaySeconds: 0,
      warpRate: 100,
      slackSeconds: 2,
    };
    // Sample-limited regime, clamp now 10 + 2 = 12.
    expect(computeConfirmedEdgeUt(inputs, 5)).toBe(12);
  });

  it("regime boundary: right where the estimate and the clamp cross, min() picks the lower one on each side", () => {
    // delaySeconds = 0, warpRate = 1 so estimate(t) = anchorUt + t.
    // maxSampleUt = 100 -> boundary at t = 0 (estimate == clamp at t=0).
    const inputs: ClockFormulaInputs = {
      anchorWall: 0,
      anchorUt: 100,
      maxSampleUt: 100,
      delaySeconds: 0,
      warpRate: 1,
      slackSeconds: 0,
    };
    expect(computeConfirmedEdgeUt(inputs, -1)).toBe(99); // estimate binds (below clamp)
    expect(computeConfirmedEdgeUt(inputs, 0)).toBe(100); // exactly equal
    expect(computeConfirmedEdgeUt(inputs, 1)).toBe(100); // clamp binds (estimate ran ahead)
  });
});
