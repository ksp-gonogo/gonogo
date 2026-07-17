import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerDelayClock } from "./worker-delay-clock";

describe("createWorkerDelayClock", () => {
  it("confirmedEdgeUt() reads -Infinity before any snapshot is ever applied (cold start)", () => {
    const clock = createWorkerDelayClock({ nowWall: () => 0 });
    expect(clock.confirmedEdgeUt()).toBe(Number.NEGATIVE_INFINITY);
  });

  it("evaluates confirmedEdgeUt() from the applied snapshot via the shared formula, sample-clamped", () => {
    let wall = 0;
    const clock = createWorkerDelayClock({ nowWall: () => wall });
    clock.applySnapshot({
      epoch: 0,
      anchorWall: 0,
      anchorUt: 10,
      maxSampleUt: 10,
      delaySeconds: 0,
      warpRate: 100, // aggressive slope
      slackSeconds: 0,
    });

    wall = 5; // raw estimate would be 10 + 5*100 = 510
    expect(clock.confirmedEdgeUt()).toBe(10); // clamped to the sample, exactly like ViewClock
  });

  it("evaluates the delay-limited regime correctly too", () => {
    let wall = 0;
    const clock = createWorkerDelayClock({ nowWall: () => wall });
    clock.applySnapshot({
      epoch: 0,
      anchorWall: 0,
      anchorUt: 100,
      maxSampleUt: 100,
      delaySeconds: 20,
      warpRate: 1,
      slackSeconds: 0,
    });
    wall = 1; // estimate = 101; edge = 101 - 20 = 81
    expect(clock.confirmedEdgeUt()).toBe(81);
  });

  describe("applySnapshot stale-epoch guard", () => {
    it("discards a snapshot whose epoch is behind the currently-applied one", () => {
      const clock = createWorkerDelayClock({ nowWall: () => 0 });
      clock.applySnapshot({
        epoch: 2,
        anchorWall: 0,
        anchorUt: 500,
        maxSampleUt: 500,
        delaySeconds: 0,
        warpRate: 1,
        slackSeconds: 0,
      });
      expect(clock.currentSnapshot().maxSampleUt).toBe(500);

      // A late-arriving epoch-1 snapshot (posted before the epoch-2 bump,
      // delivered after) must not undo the newer state — mirrors
      // ViewClock.observeSample's own stale-epoch straggler discard.
      clock.applySnapshot({
        epoch: 1,
        anchorWall: 0,
        anchorUt: 999,
        maxSampleUt: 999,
        delaySeconds: 0,
        warpRate: 1,
        slackSeconds: 0,
      });
      expect(clock.currentSnapshot().maxSampleUt).toBe(500);
      expect(clock.currentSnapshot().epoch).toBe(2);
    });

    it("accepts a same-epoch snapshot as a normal update (not treated as stale)", () => {
      const clock = createWorkerDelayClock({ nowWall: () => 0 });
      clock.applySnapshot({
        epoch: 0,
        anchorWall: 0,
        anchorUt: 10,
        maxSampleUt: 10,
        delaySeconds: 0,
        warpRate: 1,
        slackSeconds: 0,
      });
      clock.applySnapshot({
        epoch: 0,
        anchorWall: 1,
        anchorUt: 11,
        maxSampleUt: 11,
        delaySeconds: 0,
        warpRate: 1,
        slackSeconds: 0,
      });
      expect(clock.currentSnapshot().maxSampleUt).toBe(11);
    });

    it("accepts a higher-epoch snapshot even with a LOWER maxSampleUt (a genuine rewind)", () => {
      const clock = createWorkerDelayClock({ nowWall: () => 0 });
      clock.applySnapshot({
        epoch: 0,
        anchorWall: 0,
        anchorUt: 5000,
        maxSampleUt: 5000,
        delaySeconds: 0,
        warpRate: 1,
        slackSeconds: 0,
      });
      clock.applySnapshot({
        epoch: 1,
        anchorWall: 0,
        anchorUt: 4500,
        maxSampleUt: 4500,
        delaySeconds: 0,
        warpRate: 1,
        slackSeconds: 0,
      });
      expect(clock.confirmedEdgeUt()).toBe(4500); // not clamped by the dead epoch-0 peak
    });
  });

  describe("onFrame polling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts polling on the first subscriber and stops once the last unsubscribes", () => {
      let wall = 0;
      const clock = createWorkerDelayClock({
        nowWall: () => wall,
        pollIntervalMs: 16,
      });
      clock.applySnapshot({
        epoch: 0,
        anchorWall: 0,
        anchorUt: 0,
        maxSampleUt: 0,
        delaySeconds: 0,
        warpRate: 1,
        slackSeconds: 0,
      });

      const ticks: number[] = [];
      const unsubscribe = clock.onFrame((edge) => ticks.push(edge));

      wall = 1;
      vi.advanceTimersByTime(16);
      expect(ticks.length).toBeGreaterThan(0);

      const countBeforeUnsub = ticks.length;
      unsubscribe();
      vi.advanceTimersByTime(100); // no more subscribers — polling should have stopped
      expect(ticks.length).toBe(countBeforeUnsub);
    });

    it("supports multiple subscribers off one shared poll", () => {
      const clock = createWorkerDelayClock({
        nowWall: () => 0,
        pollIntervalMs: 16,
      });
      clock.applySnapshot({
        epoch: 0,
        anchorWall: 0,
        anchorUt: 0,
        maxSampleUt: 0,
        delaySeconds: 0,
        warpRate: 1,
        slackSeconds: 0,
      });

      let calls1 = 0;
      let calls2 = 0;
      const unsub1 = clock.onFrame(() => {
        calls1 += 1;
      });
      const unsub2 = clock.onFrame(() => {
        calls2 += 1;
      });

      vi.advanceTimersByTime(48); // ~3 ticks
      expect(calls1).toBeGreaterThan(0);
      expect(calls2).toBe(calls1);

      unsub1();
      unsub2();
    });
  });
});
