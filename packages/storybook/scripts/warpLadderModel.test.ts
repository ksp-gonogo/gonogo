import { describe, expect, it } from "vitest";
import { numberAt, sentOn } from "./frameValue";
import { RAILS, STEPS, warpLadderScenario } from "./warpLadderModel";

describe("the warp ladder", () => {
  it("moves one rung at a time, up and down", () => {
    for (let i = 1; i < STEPS.length; i++) {
      expect(Math.abs(STEPS[i].index - STEPS[i - 1].index)).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it("reaches the top rung and comes back to real time", () => {
    expect(Math.max(...STEPS.map((s) => s.index))).toBe(RAILS.length - 1);
    expect(STEPS.at(-1)?.index).toBe(0);
  });

  it("pauses at real time and resumes", () => {
    const paused = STEPS.filter((s) => s.paused);
    expect(paused.length).toBeGreaterThan(0);
    expect(paused.every((s) => s.index === 0)).toBe(true);
    expect(STEPS.at(-1)?.paused).toBe(false);
  });

  it("sends the rate that goes with each rung", () => {
    const { frames } = warpLadderScenario();
    frames.forEach((f, i) => {
      expect(numberAt(sentOn(f, "time.warp"), "warpRate")).toBe(
        RAILS[STEPS[i].index],
      );
    });
  });
});
