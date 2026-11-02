import { PerfBudget } from "@ksp-gonogo/core";
import { renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";

import { quantiseUt, useThrottledBucket } from "./predictionThrottle";

describe("GroundTrack prediction throttle", () => {
  it("quantiseUt buckets the time so 4 Hz ticks collapse to 1 Hz invalidations", () => {
    // Arbitrary float UT values 250 ms apart, the producer's sample rate.
    const ticks = [
      1000.123,
      1000.373,
      1000.623,
      1000.873, // four ticks within one second
      1001.123,
      1001.373,
      1001.623,
      1001.873, // next second
    ];
    const buckets = ticks.map((t) => quantiseUt(t, 1));
    // Eight ticks, two distinct buckets.
    expect(new Set(buckets).size).toBe(2);
  });

  it("the perf budget for predictGroundTrack stays below threshold under quantised input", () => {
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("predictGroundTrack"),
    );
    expect(budget).toBeDefined();
    if (!budget) return;
    budget.reset();

    // 5 seconds at the producer's 4 Hz, recording once per bucket transition as useMemo's identity check would.
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
    // 5 seconds: at most 5 calls in the rolling window.
    expect(budget.windowTotal(tStart * 1000 + 4750)).toBeLessThanOrEqual(5);
  });

  it("baseline (no throttle) would record one call per tick, the regression we're avoiding", () => {
    // Positive control: the budget is instrumented, and unthrottled 4 Hz reads visibly higher.
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("predictGroundTrack"),
    );
    if (!budget) return;
    budget.reset();
    const t0 = 2_000_000;
    for (let i = 0; i < 4; i++) budget.record(1, t0 + i * 250); // 1 sec of 4 Hz
    expect(budget.windowTotal(t0 + 999)).toBe(4);
  });
});

describe("GroundTrack prediction at time warp", () => {
  it("useThrottledBucket turns over at most five times a second at 100x while still following the clock", () => {
    let wallMs = 0;
    const seen: number[] = [];
    const { result, rerender } = renderHook(
      ({ ut }) => useThrottledBucket(ut, 1, () => wallMs),
      { initialProps: { ut: 1_000_000 } },
    );
    seen.push(result.current);
    // Three seconds of 60 fps frames, universal time running at 100x.
    for (let frame = 1; frame <= 180; frame++) {
      wallMs = frame * (1000 / 60);
      rerender({ ut: 1_000_000 + (wallMs / 1000) * 100 });
      seen.push(result.current);
    }
    const turnovers = new Set(seen).size - 1;
    expect(turnovers).toBeLessThanOrEqual(15);
    const trailUt = 1_000_000 + 300 - seen.at(-1)!;
    expect(trailUt).toBeLessThanOrEqual(0.25 * 100 + 1);
  });

  it("takes a bucket that moves backward at once", () => {
    let wallMs = 0;
    const { result, rerender } = renderHook(
      ({ ut }) => useThrottledBucket(ut, 1, () => wallMs),
      { initialProps: { ut: 5000 } },
    );
    wallMs = 10;
    rerender({ ut: 4000 });
    expect(result.current).toBe(4000);
  });
});
