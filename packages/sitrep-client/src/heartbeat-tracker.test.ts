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
});
