import { describe, expect, it } from "vitest";
import { ViewClock } from "./view-clock";

/** A wall clock a test can advance explicitly, instead of racing real time. */
function fakeWall(start = 0) {
  let now = start;
  return {
    now: () => now,
    advanceBy: (seconds: number) => {
      now += seconds;
    },
  };
}

describe("ViewClock", () => {
  it("confirmedEdgeUt is sample-clamped: never ahead of the max buffered sample, even when the estimate runs far ahead", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 100, // aggressive slope
      delaySeconds: () => 0,
    });

    clock.observeSample(/* validAt */ 10, /* deliveredAt */ 10);
    // Only one sample has ever been buffered (UT 10) — but wall time races
    // forward, so the raw estimate would run far past it.
    wall.advanceBy(5); // estimate would be 10 + 5*100 = 510

    expect(clock.utNowEstimate()).toBeGreaterThan(500); // the raw estimate really did run away
    expect(clock.confirmedEdgeUt()).toBe(10); // but the confirmed edge is clamped to the sample
  });

  it("confirmedEdgeUt also respects delaySeconds when the estimate (not the clamp) is the binding constraint", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 20,
    });

    clock.observeSample(100, 100);
    wall.advanceBy(1); // estimate = 101; edge = 101 - 20 = 81, well under the sample clamp (100)

    expect(clock.confirmedEdgeUt()).toBe(81);
  });

  it("returns -Infinity before any sample has ever been observed (resynchronizing state)", () => {
    const clock = new ViewClock();
    expect(clock.confirmedEdgeUt()).toBe(Number.NEGATIVE_INFINITY);
  });

  it("viewUt() is monotonic non-decreasing within an epoch even if confirmedEdgeUt momentarily reads lower", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });

    clock.observeSample(100, 100);
    expect(clock.viewUt()).toBe(100);

    // A later, smaller-validAt sample would otherwise pull the estimate
    // backwards (e.g. a correction inside the same epoch) — viewUt must not
    // recede.
    clock.observeSample(50, 50);
    expect(clock.viewUt()).toBe(100);
  });

  describe("per-epoch reset", () => {
    it("resets the fit, sample clamp, and monotonic cursor on a higher-epoch observation", () => {
      const wall = fakeWall();
      const clock = new ViewClock({
        nowWall: wall.now,
        warpRate: () => 1,
        delaySeconds: () => 0,
      });

      clock.observeSample(5000, 5000, 0);
      expect(clock.viewUt()).toBe(5000);
      expect(clock.getEpoch()).toBe(0);

      // Quickload rewind to UT 4500, new epoch.
      clock.observeSample(4500, 4500, 1);

      expect(clock.getEpoch()).toBe(1);
      expect(clock.confirmedEdgeUt()).toBe(4500); // not clamped by the dead epoch-0 peak of 5000
      expect(clock.viewUt()).toBe(4500); // cursor did not freeze at the old 5000 peak
    });

    it("discards a stale-epoch straggler observation after the epoch has bumped", () => {
      const wall = fakeWall();
      const clock = new ViewClock({
        nowWall: wall.now,
        warpRate: () => 1,
        delaySeconds: () => 0,
      });

      clock.observeSample(4500, 4500, 1);
      clock.observeSample(5000, 5000, 0); // late epoch-0 straggler

      expect(clock.getEpoch()).toBe(1);
      expect(clock.confirmedEdgeUt()).toBe(4500); // unaffected by the stale observation
    });
  });

  it("confidence() reports coasting after a period of silence and locked right after an observation", () => {
    const wall = fakeWall();
    const clock = new ViewClock({ nowWall: wall.now, coastingAfterSeconds: 5 });

    expect(clock.confidence()).toBe("coasting"); // nothing observed yet

    clock.observeSample(10, 10);
    expect(clock.confidence()).toBe("locked");

    wall.advanceBy(10);
    expect(clock.confidence()).toBe("coasting");
  });
});
