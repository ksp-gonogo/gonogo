import { describe, expect, it } from "vitest";
import { quantiseUt } from "../MapView/predictionThrottle";
import { createUtBucketThrottle } from "./utBucketThrottle";

/**
 * Simulates a render loop: 60 frames per real second, game UT advancing at
 * `warp` game-seconds per real-second. Returns how many DISTINCT buckets each
 * strategy produced, which is how many times the expensive projection solve
 * would have re-run.
 */
function rebuildsPerRealSecond(warp: number, seconds = 3) {
  const throttle = createUtBucketThrottle({ bucketSec: 1, minRealMs: 1000 });
  const frames = 60 * seconds;
  let rawChanges = 0;
  let throttledChanges = 0;
  let lastRaw: number | null = null;
  let lastThrottled: number | null = null;
  for (let f = 0; f < frames; f++) {
    const realMs = (f / 60) * 1000;
    const ut = 1_000_000 + (f / 60) * warp;
    const raw = quantiseUt(ut, 1);
    if (raw !== lastRaw) {
      rawChanges++;
      lastRaw = raw;
    }
    const throttled = throttle(ut, realMs);
    if (throttled !== lastThrottled) {
      throttledChanges++;
      lastThrottled = throttled;
    }
  }
  return {
    raw: rawChanges / seconds,
    throttled: throttledChanges / seconds,
  };
}

describe("SystemView UT bucket throttle", () => {
  it("advances about once a real second at 1x, so it is not merely frozen", () => {
    const { throttled } = rebuildsPerRealSecond(1);
    // The control that matters: an over-aggressive throttle would pass the warp
    // assertion below by never advancing at all, and would freeze the diagram.
    expect(throttled).toBeGreaterThanOrEqual(0.9);
    expect(throttled).toBeLessThanOrEqual(1.5);
  });

  it("still rebuilds about once a real second at 100x warp", () => {
    const { throttled } = rebuildsPerRealSecond(100);
    expect(throttled).toBeLessThanOrEqual(1.5);
  });

  it("is what the bare game-time bucket fails to do, which is the defect", () => {
    // At 100x, one game second passes in well under one frame, so the bare
    // bucket changes every frame and stops throttling anything. 34 bodies x 97
    // placements x 60 changes/sec is the ~198,000/sec the placement budget
    // calls its regression, produced here by ordinary time warp.
    const { raw, throttled } = rebuildsPerRealSecond(100);
    expect(raw).toBeGreaterThan(50);
    expect(throttled * 20).toBeLessThan(raw);
  });

  it("does not churn while the game clock is paused", () => {
    const throttle = createUtBucketThrottle({ bucketSec: 1, minRealMs: 1000 });
    const first = throttle(1_000_000, 0);
    const buckets = new Set([first]);
    for (let f = 1; f < 300; f++) buckets.add(throttle(1_000_000, f * 16.7));
    expect(buckets.size).toBe(1);
  });
});
