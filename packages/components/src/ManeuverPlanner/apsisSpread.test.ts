import { describe, expect, it } from "vitest";
import {
  apsisInstantSpread,
  apsisIsDefined,
  recordApsisInstant,
} from "./apsisSpread";

const PERIOD = 4960;

describe("apsis instant spread", () => {
  it("is nothing for instants that agree", () => {
    expect(apsisInstantSpread([1000, 1000.02, 999.98], PERIOD)).toBeLessThan(
      0.1,
    );
  });

  it("is the scatter of the instants, which for 22:25, 22:08 and 22:32 of countdown is 24 s", () => {
    // Countdowns read at the same UT.
    const instants = [22 * 60 + 25, 22 * 60 + 8, 22 * 60 + 32];
    expect(apsisInstantSpread(instants, PERIOD)).toBeCloseTo(24, 5);
  });

  it("does not count a lap of the period as scatter", () => {
    expect(
      apsisInstantSpread([1000, 1000 + PERIOD, 1000.3], PERIOD),
    ).toBeCloseTo(0.3, 5);
  });
});

describe("recording instants", () => {
  it("takes one per sample, not one per frame", () => {
    const window: number[] = [];
    for (const instant of [500, 500, 500.0000001, 500]) {
      recordApsisInstant(window, instant);
    }
    expect(window).toEqual([500]);
  });

  it("keeps only the recent ones", () => {
    const window: number[] = [];
    for (let i = 0; i < 20; i++) recordApsisInstant(window, 100 + i);
    expect(window).toHaveLength(6);
    expect(window.at(-1)).toBe(119);
  });
});

describe("whether the apsis is defined", () => {
  it("says nothing before three samples", () => {
    expect(apsisIsDefined([1000, 1000.1], PERIOD)).toBeUndefined();
    expect(apsisIsDefined([1000, 1000.1, 1000.1], undefined)).toBeUndefined();
  });

  it("is defined where successive samples agree to the second", () => {
    expect(apsisIsDefined([1000, 1000.2, 999.9, 1000.1], PERIOD)).toBe(true);
  });

  it("is not defined where they scatter wider than the countdown resolves", () => {
    expect(apsisIsDefined([1345, 1328, 1352], PERIOD)).toBe(false);
  });
});
