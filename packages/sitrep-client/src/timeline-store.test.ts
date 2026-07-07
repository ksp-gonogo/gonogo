import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function fakeWall(start = 0) {
  let now = start;
  return {
    now: () => now,
    advanceBy: (seconds: number) => {
      now += seconds;
    },
  };
}

function point(
  validAt: number,
  payload: number | null,
  overrides: { epoch?: number; deliveredAt?: number } = {},
): TimelinePoint<number | null> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: overrides.deliveredAt ?? validAt }),
    epoch: overrides.epoch ?? 0,
  };
}

describe("TimelineStore", () => {
  it("ingests a sample into its topic's timeline and feeds the shared ViewClock", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    store.ingest("vessel.orbit", point(10, 111));
    store.beginFrame();

    expect(store.sample<number>("vessel.orbit")?.payload).toBe(111);
    expect(store.getTimeline("vessel.orbit").latest()?.payload).toBe(111);
  });

  it("sample() with no explicit token reads at the current frame's frozen viewUt, not a freshly computed one", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      delaySeconds: () => 0,
      warpRate: () => 1,
    });
    const store = new TimelineStore(clock);

    store.ingest("a", point(10, 1));
    store.ingest("a", point(20, 2));
    store.beginFrame(); // freezes viewUt at 20 (max buffered sample, delay 0)

    expect(store.sample<number>("a")?.payload).toBe(2);

    // A later sample arrives mid-frame (before the next beginFrame) — the
    // frozen token must not see it.
    store.ingest("a", point(30, 3));
    expect(store.sample<number>("a")?.payload).toBe(2);

    store.beginFrame(); // now the frame advances and picks up the new sample
    expect(store.sample<number>("a")?.payload).toBe(3);
  });

  describe("frozen-viewUt-per-frame invariant", () => {
    it("two different topics read in the same frame see the identical view UT, even though the live clock has moved on by the second read", () => {
      const wall = fakeWall();
      // delaySeconds keeps the estimate (not the sample clamp) the binding
      // constraint, so the live clock genuinely keeps advancing across the
      // wall-time tick below instead of sitting clamped at the sample.
      const clock = new ViewClock({
        nowWall: wall.now,
        delaySeconds: () => 50,
        warpRate: () => 1,
      });
      const store = new TimelineStore(clock);

      store.ingest("topic.a", point(0, 10));
      store.ingest("topic.a", point(100, 11));
      store.ingest("topic.b", point(0, 20));
      store.ingest("topic.b", point(100, 21));

      const token = store.beginFrame();
      expect(token.viewUt).toBe(50); // estimate (100 - 50 delay) well under the sample clamp of 100

      const a = store.sample<number>("topic.a", store.currentFrame());
      // Wall time advances mid-frame (e.g. a slow widget's own work) — a
      // live clock read would now disagree with the frozen token.
      wall.advanceBy(10);
      const b = store.sample<number>("topic.b", store.currentFrame());

      expect(clock.viewUt()).toBe(60); // proves the live clock DID move on
      expect(store.currentFrame().viewUt).toBe(50); // but the frame token stayed frozen
      expect(a?.payload).toBe(10);
      expect(b?.payload).toBe(20);
    });

    it("currentFrame() itself never changes between beginFrame() calls, regardless of how many times it's read", () => {
      const wall = fakeWall();
      const clock = new ViewClock({
        nowWall: wall.now,
        delaySeconds: () => 0,
        warpRate: () => 50,
      });
      const store = new TimelineStore(clock);
      store.ingest("x", point(1, 1));

      const token = store.beginFrame();
      for (let i = 0; i < 5; i++) {
        wall.advanceBy(1);
        expect(store.currentFrame()).toBe(token); // same object identity, not just equal value
      }
    });
  });

  describe("per-epoch reset", () => {
    it("dropping a topic's superseded points on a higher-epoch ingest also resets the shared ViewClock's cursor", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);

      store.ingest("vessel.orbit", point(5000, 111, { epoch: 0 }));
      store.beginFrame();
      expect(store.sample<number>("vessel.orbit")?.payload).toBe(111);
      expect(store.currentFrame().viewUt).toBe(5000);

      // Quickload rewind.
      store.ingest("vessel.orbit", point(4500, 999, { epoch: 1 }));
      const token = store.beginFrame();

      expect(store.getTimeline("vessel.orbit").epoch).toBe(1);
      expect(token.viewUt).toBe(4500); // not stuck at the dead epoch-0 peak of 5000
      expect(store.sample<number>("vessel.orbit", token)?.payload).toBe(999);
      // The client-side stale-ghost check: nothing about epoch 0 survives.
      expect(store.getTimeline("vessel.orbit").range(0, 10000)).toHaveLength(1);
    });
  });
});
