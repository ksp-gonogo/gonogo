import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import { ClientTimeline, type TimelinePoint } from "./timeline";

function point(
  validAt: number,
  payload: number | null,
  overrides: { epoch?: number; seq?: number } = {},
): TimelinePoint<number | null> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, seq: overrides.seq ?? 0 }),
    epoch: overrides.epoch ?? 0,
  };
}

describe("ClientTimeline", () => {
  it("ingests points and reads the latest value at-or-before a UT (hold-last)", () => {
    const timeline = new ClientTimeline<number | null>();
    timeline.append(point(10, 100));
    timeline.append(point(20, 200));
    timeline.append(point(30, 300));

    expect(timeline.at(5)).toBeUndefined(); // before first point
    expect(timeline.at(10)?.payload).toBe(100);
    expect(timeline.at(15)?.payload).toBe(100); // holds last known
    expect(timeline.at(20)?.payload).toBe(200);
    expect(timeline.at(29)?.payload).toBe(200);
    expect(timeline.at(30)?.payload).toBe(300);
    expect(timeline.at(1000)?.payload).toBe(300); // latest holds forever
  });

  it("inserts out-of-order deliveries sorted by validAt", () => {
    const timeline = new ClientTimeline<number | null>();
    timeline.append(point(30, 300));
    timeline.append(point(10, 100));
    timeline.append(point(20, 200));

    expect(timeline.at(15)?.payload).toBe(100);
    expect(timeline.at(25)?.payload).toBe(200);
    expect(timeline.latest()?.payload).toBe(300);
  });

  it("range() returns points inclusive of both bounds", () => {
    const timeline = new ClientTimeline<number | null>();
    timeline.append(point(10, 100));
    timeline.append(point(20, 200));
    timeline.append(point(30, 300));

    expect(timeline.range(10, 20).map((p) => p.payload)).toEqual([100, 200]);
    expect(timeline.range(11, 19)).toEqual([]);
  });

  it("bumps revision on append and on eviction, not on a no-op evictBelow", () => {
    const timeline = new ClientTimeline<number | null>();
    timeline.append(point(10, 100));
    const afterAppend = timeline.revision;
    expect(afterAppend).toBeGreaterThan(0);

    timeline.evictBelow(-1000); // no-op, nothing below this bound
    expect(timeline.revision).toBe(afterAppend);

    timeline.evictBelow(10.5); // evicts the point at validAt 10
    expect(timeline.revision).toBeGreaterThan(afterAppend);
    expect(timeline.at(1000)).toBeUndefined();
  });

  it("is bounded to a retention window behind the latest ingested sample — old points are evicted", () => {
    const timeline = new ClientTimeline<number | null>({
      retentionSeconds: 100,
    });
    timeline.append(point(0, 0));
    timeline.append(point(50, 50));
    expect(timeline.at(50)?.payload).toBe(50);
    expect(timeline.range(0, 50).length).toBe(2);

    // Pushes the retention floor to 150 (250 - 100) — the two old points
    // (validAt 0, 50) fall outside the window and are evicted.
    timeline.append(point(250, 250));

    expect(timeline.range(0, 50)).toEqual([]);
    expect(timeline.at(50)).toBeUndefined();
    expect(timeline.at(250)?.payload).toBe(250);
  });

  describe("per-epoch reset (client-side ghost avoidance)", () => {
    it("drops epoch-0 points and never returns epoch-0 data once a higher-epoch sample arrives (rewind)", () => {
      const timeline = new ClientTimeline<number | null>();
      timeline.append(point(100, 111, { epoch: 0 }));
      expect(timeline.at(100)?.payload).toBe(111);
      expect(timeline.epoch).toBe(0);

      // Quickload rewind: engine restarts UT lower, under a new epoch.
      timeline.append(point(50, 999, { epoch: 1 }));

      expect(timeline.epoch).toBe(1);
      // The stale-ghost check: reading anywhere, including at/after the old
      // epoch-0 validAt, must never resurrect epoch-0's payload.
      expect(timeline.at(100)?.payload).toBe(999);
      expect(timeline.at(1000)?.payload).toBe(999);
      expect(timeline.range(0, 1000).map((p) => p.payload)).toEqual([999]);
    });

    it("discards a stale-epoch straggler that arrives after the epoch has already bumped", () => {
      const timeline = new ClientTimeline<number | null>();
      timeline.append(point(50, 999, { epoch: 1 }));
      const revisionAfterBump = timeline.revision;

      // A late-arriving epoch-0 sample, queued behind the rewind.
      timeline.append(point(200, 111, { epoch: 0 }));

      expect(timeline.epoch).toBe(1);
      expect(timeline.revision).toBe(revisionAfterBump); // no-op, not appended
      expect(timeline.at(1000)?.payload).toBe(999);
    });
  });
});
