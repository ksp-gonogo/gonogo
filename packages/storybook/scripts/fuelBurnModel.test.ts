import { describe, expect, it } from "vitest";
import { lengthOf, numberAt, sentOn } from "./frameValue";
import { BURN_FRAMES, fillAfter, fuelBurnScenario } from "./fuelBurnModel";

const STAGES = [
  { stage: 2, burnTime: 100 },
  { stage: 1, burnTime: 50 },
  { stage: 0, burnTime: 25 },
];

describe("fillAfter", () => {
  it("drains the top stage before the next one is touched", () => {
    expect(fillAfter(STAGES, 50)).toEqual([0.5, 1, 1]);
  });

  it("empties stages in order and never goes below zero", () => {
    expect(fillAfter(STAGES, 120)).toEqual([0, 0.6, 1]);
    expect(fillAfter(STAGES, 9999)).toEqual([0, 0, 0]);
  });
});

describe("fuelBurnScenario", () => {
  const { frames } = fuelBurnScenario();
  const dvOf = (i: number) =>
    numberAt(sentOn(frames[i], "dv.summary"), "totalDvActual");

  it("has a frame for every step, plus the full stack", () => {
    expect(frames).toHaveLength(BURN_FRAMES + 1);
  });

  it("only ever loses delta-v", () => {
    for (let i = 1; i < frames.length; i++) {
      expect(dvOf(i)).toBeLessThan(dvOf(i - 1));
    }
  });

  it("drops a stage from the list once its tanks are empty, and the current stage follows", () => {
    const stageCount = (i: number) => lengthOf(sentOn(frames[i], "dv.stages"));
    expect(stageCount(0)).toBe(5);
    expect(stageCount(frames.length - 1)).toBeLessThan(5);
    const current = (i: number) =>
      numberAt(sentOn(frames[i], "vessel.structure"), "currentStage");
    expect(current(frames.length - 1)).toBeLessThan(current(0));
  });
});
