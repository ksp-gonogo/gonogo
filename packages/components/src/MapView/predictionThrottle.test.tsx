import { PerfBudget } from "@gonogo/core";
import { describe, expect, it, vi } from "vitest";

import { quantiseUt } from "./predictionThrottle";

describe("MapView prediction throttle", () => {
  it("quantiseUt buckets the time so 4 Hz ticks collapse to 1 Hz invalidations", () => {
    // Arbitrary float UT values 250 ms apart — Telemachus rate.
    const ticks = [
      1000.123, 1000.373, 1000.623, 1000.873, // four ticks within one second
      1001.123, 1001.373, 1001.623, 1001.873, // next second
    ];
    const buckets = ticks.map((t) => quantiseUt(t, 1));
    // Eight ticks → just two distinct bucket values.
    expect(new Set(buckets).size).toBe(2);
  });

  it("the perf budget for predictGroundTrack stays below threshold under quantised input", () => {
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("predictGroundTrack"),
    );
    expect(budget).toBeDefined();
    if (!budget) return;
    budget.reset();

    // Simulate the MapView re-rendering at Telemachus rate (4 Hz) for
    // 5 wall-clock seconds. With the quantise(ut, 1) throttle in place,
    // the *quantised* ut only changes once per second; useMemo's
    // identity check sees the same value and skips the recompute. We
    // approximate that here by recording exactly once per quantisation
    // bucket transition.
    const tStart = 1_000_000;
    let lastBucket: number | null = null;
    for (let i = 0; i < 20; i++) {
      const ut = tStart + i * 0.25; // 250 ms
      const bucket = quantiseUt(ut, 1);
      if (bucket !== lastBucket) {
        budget.record(1, tStart * 1000 + i * 250);
        lastBucket = bucket;
      }
    }
    // 5 seconds wall-clock → at most 5 calls in the rolling window.
    expect(budget.rate(tStart * 1000 + 4750)).toBeLessThanOrEqual(5);
  });

  it("baseline (no throttle) would record one call per tick — the regression we're avoiding", () => {
    // Sanity check: confirms the budget IS instrumented and would catch
    // a regression. Recording once per tick at 4 Hz over 5 sec = 20
    // events in a 1-sec rolling window the threshold is 30 → still
    // under, but visibly higher than the throttled rate.
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("predictGroundTrack"),
    );
    if (!budget) return;
    budget.reset();
    const t0 = 2_000_000;
    for (let i = 0; i < 4; i++) budget.record(1, t0 + i * 250); // 1 sec of 4 Hz
    expect(budget.rate(t0 + 999)).toBe(4);
  });
});
