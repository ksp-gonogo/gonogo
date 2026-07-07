import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYFRAME_INTERVAL_UT,
  HeartbeatTracker,
} from "./heartbeat-tracker";

describe("HeartbeatTracker", () => {
  it("a topic with no recorded arrival is never overdue (that's 'resyncing', handled a layer up)", () => {
    const tracker = new HeartbeatTracker();
    expect(tracker.isOverdue("vessel.target", 1_000_000, "locked")).toBe(false);
  });

  it("stays not-overdue while the view UT is within one interval + margin of the last arrival", () => {
    const tracker = new HeartbeatTracker({
      defaultKeyframeIntervalUt: 30,
      marginMultiplier: 1,
      jitterAllowanceUt: 0,
    });
    tracker.noteArrival("vessel.target", 100);

    // margin(locked) = 30 * 1 + 0 = 30 -> overdue threshold is 100+30+30=160
    expect(tracker.isOverdue("vessel.target", 159, "locked")).toBe(false);
    expect(tracker.isOverdue("vessel.target", 160, "locked")).toBe(false); // strictly greater-than
    expect(tracker.isOverdue("vessel.target", 161, "locked")).toBe(true);
  });

  it("a later arrival clears a would-be-overdue expectation", () => {
    const tracker = new HeartbeatTracker({ defaultKeyframeIntervalUt: 30 });
    tracker.noteArrival("vessel.target", 100);
    expect(tracker.isOverdue("vessel.target", 500, "locked")).toBe(true);

    tracker.noteArrival("vessel.target", 500);
    expect(tracker.isOverdue("vessel.target", 500, "locked")).toBe(false);
  });

  it("an out-of-order (earlier) arrival never moves the tracked heartbeat backwards", () => {
    const tracker = new HeartbeatTracker({ defaultKeyframeIntervalUt: 30 });
    tracker.noteArrival("vessel.target", 500);
    tracker.noteArrival("vessel.target", 100); // stale/out-of-order, ignored

    // Still measured from 500, not regressed to 100.
    expect(tracker.isOverdue("vessel.target", 500 + 30, "locked")).toBe(false);
  });

  it("reset() clears tracked heartbeats back to the never-arrived (not overdue) state", () => {
    const tracker = new HeartbeatTracker({ defaultKeyframeIntervalUt: 30 });
    tracker.noteArrival("vessel.target", 100);
    expect(tracker.isOverdue("vessel.target", 1000, "locked")).toBe(true);

    tracker.reset();
    expect(tracker.isOverdue("vessel.target", 1000, "locked")).toBe(false);
  });

  describe("per-topic keyframe interval", () => {
    it("uses a per-topic override in preference to the default", () => {
      const tracker = new HeartbeatTracker({
        defaultKeyframeIntervalUt: 30,
        keyframeIntervalUt: { "vessel.orbit": 5 },
        marginMultiplier: 1,
        jitterAllowanceUt: 0,
      });
      expect(tracker.intervalFor("vessel.orbit")).toBe(5);
      expect(tracker.intervalFor("vessel.target")).toBe(30);
    });

    it("falls back to DEFAULT_KEYFRAME_INTERVAL_UT when nothing is configured", () => {
      const tracker = new HeartbeatTracker();
      expect(tracker.intervalFor("anything")).toBe(
        DEFAULT_KEYFRAME_INTERVAL_UT,
      );
    });
  });

  describe("confidence-scaled margin (M2 design §4.3/§7.1)", () => {
    it("marginUt is strictly wider when confidence is not 'locked'", () => {
      const tracker = new HeartbeatTracker({
        defaultKeyframeIntervalUt: 30,
        marginMultiplier: 1,
        jitterAllowanceUt: 0,
        degradedMarginMultiplier: 3,
      });

      const locked = tracker.marginUt("vessel.target", "locked");
      const coasting = tracker.marginUt("vessel.target", "coasting");
      const degraded = tracker.marginUt("vessel.target", "degraded");

      expect(coasting).toBeGreaterThan(locked);
      expect(degraded).toBeGreaterThan(locked);
      expect(coasting).toBe(locked * 3);
      expect(degraded).toBe(locked * 3);
    });

    it("a widened margin under 'coasting' confidence keeps a topic live past the point it would have flipped under 'locked'", () => {
      const tracker = new HeartbeatTracker({
        defaultKeyframeIntervalUt: 30,
        marginMultiplier: 1,
        jitterAllowanceUt: 0,
        degradedMarginMultiplier: 3,
      });
      tracker.noteArrival("vessel.target", 100);

      // Threshold under "locked": 100 + 30 + 30 = 160.
      const viewUt = 170; // past the locked threshold...
      expect(tracker.isOverdue("vessel.target", viewUt, "locked")).toBe(true);
      // ...but still within the widened "coasting" margin: 100 + 30 + 90 = 220.
      expect(tracker.isOverdue("vessel.target", viewUt, "coasting")).toBe(
        false,
      );
    });
  });

  describe("adaptive per-channel keyframe cadence (M2 §4.3, finding B item 2 — T4's deferred fixed-default issue)", () => {
    it("a fast-cadence topic (~5 UT) and a slow-cadence topic (~30 UT) each learn their own interval from observed arrivals, not a shared fixed default", () => {
      const tracker = new HeartbeatTracker({
        marginMultiplier: 1,
        jitterAllowanceUt: 0,
      });

      for (const t of [0, 5, 10]) tracker.noteArrival("fast.topic", t);
      for (const t of [0, 30, 60]) tracker.noteArrival("slow.topic", t);

      expect(tracker.intervalFor("fast.topic")).toBe(5);
      expect(tracker.intervalFor("slow.topic")).toBe(30);
    });

    it("each learned interval drives its OWN overdue threshold: the 5 UT topic flips held-stale sooner after silence than the 30 UT topic, even though both went silent at the same UT", () => {
      const tracker = new HeartbeatTracker({
        marginMultiplier: 1,
        jitterAllowanceUt: 0,
      });

      // Both topics' last arrival lands on UT 100, so "silence since" is
      // directly comparable — only their learned cadence differs.
      for (const t of [85, 90, 95, 100]) tracker.noteArrival("fast.topic", t);
      for (const t of [40, 70, 100]) tracker.noteArrival("slow.topic", t);

      // fast: threshold = 100 + learned(5) + margin(5) = 110.
      // slow: threshold = 100 + learned(30) + margin(30) = 160.
      expect(tracker.isOverdue("fast.topic", 105, "locked")).toBe(false);
      expect(tracker.isOverdue("slow.topic", 105, "locked")).toBe(false);

      // Squarely between the two thresholds: fast has flipped, slow hasn't.
      expect(tracker.isOverdue("fast.topic", 120, "locked")).toBe(true);
      expect(tracker.isOverdue("slow.topic", 120, "locked")).toBe(false);

      // Past both thresholds.
      expect(tracker.isOverdue("fast.topic", 170, "locked")).toBe(true);
      expect(tracker.isOverdue("slow.topic", 170, "locked")).toBe(true);
    });

    it("falls back to the configured default until enough arrivals have been observed to trust a learned interval", () => {
      const tracker = new HeartbeatTracker({ defaultKeyframeIntervalUt: 30 });
      expect(tracker.intervalFor("vessel.target")).toBe(30);

      tracker.noteArrival("vessel.target", 0);
      // A single arrival has zero observed gaps — still the default.
      expect(tracker.intervalFor("vessel.target")).toBe(30);

      tracker.noteArrival("vessel.target", 5);
      // One observed gap (5) is not yet enough to trust over the default.
      expect(tracker.intervalFor("vessel.target")).toBe(30);

      tracker.noteArrival("vessel.target", 10);
      // A second observed gap (5, 5) is enough to trust the learned value.
      expect(tracker.intervalFor("vessel.target")).toBe(5);
    });

    it("an explicit per-topic override always wins over a learned interval", () => {
      const tracker = new HeartbeatTracker({
        keyframeIntervalUt: { "vessel.target": 42 },
      });
      for (const t of [0, 5, 10, 15]) tracker.noteArrival("vessel.target", t);

      expect(tracker.intervalFor("vessel.target")).toBe(42);
    });

    it("a single long gap (e.g. a comms blackout) does not permanently inflate the learned interval once healthy arrivals resume", () => {
      const tracker = new HeartbeatTracker();

      for (const t of [0, 5, 10, 15]) tracker.noteArrival("vessel.target", t);
      expect(tracker.intervalFor("vessel.target")).toBe(5);

      // One long silent gap...
      tracker.noteArrival("vessel.target", 75); // gap of 60
      // ...then healthy 5 UT cadence resumes.
      tracker.noteArrival("vessel.target", 80);
      tracker.noteArrival("vessel.target", 85);

      // The median-based estimator resists the single 60 UT outlier — the
      // learned interval stays anchored near the healthy 5 UT cadence.
      expect(tracker.intervalFor("vessel.target")).toBe(5);
    });

    it("reset() also un-learns the per-topic interval, falling back to the configured default", () => {
      const tracker = new HeartbeatTracker({ defaultKeyframeIntervalUt: 30 });
      for (const t of [0, 5, 10, 15]) tracker.noteArrival("vessel.target", t);
      expect(tracker.intervalFor("vessel.target")).toBe(5);

      tracker.reset();
      expect(tracker.intervalFor("vessel.target")).toBe(30);
    });
  });
});
