import { describe, expect, it } from "vitest";
import { SampleStepTracker } from "./sample-step-tracker";

function feed(tracker: SampleStepTracker, walls: number[]) {
  walls.forEach((wall, i) => {
    tracker.observe(i + 1, wall);
  });
}

describe("SampleStepTracker", () => {
  it("has no step until two advances have been seen", () => {
    const t = new SampleStepTracker();

    expect(t.stepSeconds()).toBeUndefined();
    t.observe(1, 0);
    expect(t.stepSeconds()).toBeUndefined();
    t.observe(2, 1);
    expect(t.stepSeconds()).toBe(1);
  });

  it("measures a steady cadence", () => {
    const t = new SampleStepTracker();
    feed(t, [0, 0.1, 0.2, 0.3, 0.4, 0.5]);

    expect(t.stepSeconds()).toBeCloseTo(0.1, 6);
  });

  it("ignores a lone burst of close samples", () => {
    const t = new SampleStepTracker();
    feed(t, [0, 1, 2, 2.02, 3, 4]);

    expect(t.stepSeconds()).toBeCloseTo(1, 6);
  });

  it("follows a change from a step a second to ten a second", () => {
    const t = new SampleStepTracker();
    feed(t, [0, 1, 2, 3, 4, 4.1, 4.2, 4.3, 4.4]);

    expect(t.stepSeconds()).toBeCloseTo(0.1, 6);
  });

  it("does not count a sample that does not advance", () => {
    const t = new SampleStepTracker();
    t.observe(1, 0);
    t.observe(1, 0.5);
    t.observe(0.5, 0.7);

    expect(t.stepSeconds()).toBeUndefined();
  });

  it("starts again after a reset", () => {
    const t = new SampleStepTracker();
    feed(t, [0, 1, 2]);
    t.reset();

    expect(t.stepSeconds()).toBeUndefined();
  });
});
