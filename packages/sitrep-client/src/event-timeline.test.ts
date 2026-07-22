import { describe, expect, it } from "vitest";
import { type EventOccurrence, EventTimeline } from "./event-timeline";

function occ(
  ut: number,
  kind: string,
  payload: unknown = null,
  epoch = 0,
): EventOccurrence {
  return { ut, kind, payload, epoch };
}

describe("EventTimeline", () => {
  it("keeps occurrences sorted by ut regardless of arrival order", () => {
    const t = new EventTimeline();
    t.append(occ(30, "b"));
    t.append(occ(10, "a"));
    t.append(occ(20, "c"));
    expect(t.all().map((o) => o.ut)).toEqual([10, 20, 30]);
    expect(t.latest()?.ut).toBe(30);
  });

  it("keeps arrival order for occurrences at the same ut", () => {
    const t = new EventTimeline();
    t.append(occ(10, "first"));
    t.append(occ(10, "second"));
    expect(t.all().map((o) => o.kind)).toEqual(["first", "second"]);
  });

  describe("reveal gating", () => {
    it("hides an occurrence until now passes ut + delay", () => {
      const t = new EventTimeline();
      t.append(occ(100, "storm"));
      expect(t.revealed({ now: 104, delaySeconds: 5 })).toEqual([]);
      expect(
        t.revealed({ now: 105, delaySeconds: 5 }).map((o) => o.ut),
      ).toEqual([100]);
    });

    it("reveals immediately with zero delay (LAN / TrueNow)", () => {
      const t = new EventTimeline();
      t.append(occ(100, "storm"));
      expect(t.revealed({ now: 100 }).map((o) => o.ut)).toEqual([100]);
    });

    it("drops occurrences whose ut fell during a blackout, forever", () => {
      const t = new EventTimeline();
      t.append(occ(50, "during-blackout"));
      t.append(occ(150, "after-recovery"));
      // Link down 0..100, up thereafter.
      const connectivityAt = (ut: number) => ut >= 100;
      // Even long after both matured, the blackout one never reveals.
      const revealed = t.revealed({ now: 10_000, connectivityAt });
      expect(revealed.map((o) => o.kind)).toEqual(["after-recovery"]);
    });
  });

  describe("range / since queries", () => {
    it("range is inclusive on both bounds", () => {
      const t = new EventTimeline();
      [10, 20, 30, 40].forEach((ut) => {
        t.append(occ(ut, `e`));
      });
      expect(t.range(20, 30).map((o) => o.ut)).toEqual([20, 30]);
    });

    it("since is strictly after", () => {
      const t = new EventTimeline();
      [10, 20, 30].forEach((ut) => {
        t.append(occ(ut, `e`));
      });
      expect(t.since(20).map((o) => o.ut)).toEqual([30]);
    });
  });

  describe("epoch / rewind", () => {
    it("discards a stale-epoch straggler", () => {
      const t = new EventTimeline();
      t.append(occ(10, "a", null, 1));
      t.append(occ(5, "stale", null, 0));
      expect(t.epoch).toBe(1);
      expect(t.all().map((o) => o.kind)).toEqual(["a"]);
    });

    it("drops the whole buffer on a higher-epoch rewind", () => {
      const t = new EventTimeline();
      t.append(occ(10, "old", null, 0));
      t.append(occ(20, "old2", null, 0));
      t.append(occ(5, "new", null, 1));
      expect(t.epoch).toBe(1);
      expect(t.all().map((o) => o.kind)).toEqual(["new"]);
    });

    it("adoptEpoch clears when higher and no-ops otherwise", () => {
      const t = new EventTimeline();
      t.append(occ(10, "a", null, 2));
      t.adoptEpoch(1);
      expect(t.all()).toHaveLength(1);
      t.adoptEpoch(3);
      expect(t.all()).toHaveLength(0);
      expect(t.epoch).toBe(3);
    });
  });

  describe("retention", () => {
    it("auto-evicts occurrences older than the retention window", () => {
      const t = new EventTimeline({ retentionSeconds: 100 });
      t.append(occ(10, "old"));
      t.append(occ(200, "new"));
      // latest ut 200 - 100 retention = 100 floor, so ut 10 is gone.
      expect(t.all().map((o) => o.kind)).toEqual(["new"]);
    });

    it("evictBelow drops occurrences under an external bound", () => {
      const t = new EventTimeline();
      [10, 20, 30].forEach((ut) => {
        t.append(occ(ut, `e`));
      });
      t.evictBelow(20);
      expect(t.all().map((o) => o.ut)).toEqual([20, 30]);
    });
  });
});
