import { describe, expect, it, vi } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedChannelDefinition } from "./timeline-store";
import { lerpPayload, TimelineStore } from "./timeline-store";
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

  describe("cross-topic epoch ghost — store is the epoch authority (Defect 1+2)", () => {
    it("a slow topic that hasn't re-sampled since a rewind reads cold, not its dead-epoch point", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);

      // Both topics have epoch-0 history before the rewind.
      store.ingest("fast.a", point(100, 1, { epoch: 0 }));
      store.ingest("slow.b", point(100, 2, { epoch: 0 }));
      store.beginFrame();
      expect(store.sample<number>("slow.b")?.payload).toBe(2);

      // Quickload rewind confirmed on the fast topic only — the slow topic
      // never re-samples.
      store.ingest("fast.a", point(50, 999, { epoch: 1 }));
      const token = store.beginFrame();

      expect(store.clock.getEpoch()).toBe(1);
      // The client ghost: slow.b's ClientTimeline still physically holds its
      // epoch-0 point (nothing told IT to reset) and would happily serve it
      // forever without the store-level guard.
      expect(store.sample<number>("slow.b", token)).toBeUndefined();
      // Proactive sweep: the dead-epoch point is actually gone, not just
      // masked at read time.
      expect(store.getTimeline("slow.b").range(0, 10000)).toEqual([]);
    });

    it("an epoch-0 straggler for a topic that never saw the epoch bump is refused, not admitted", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);

      store.ingest("fast.a", point(50, 999, { epoch: 1 }));
      const token = store.beginFrame();
      expect(store.clock.getEpoch()).toBe(1);

      // topic.c's very first-ever sample arrives late, still tagged epoch 0
      // (queued behind the rewind broadcast) — it must not be admitted.
      store.ingest("topic.c", point(40, 111, { epoch: 0 }));

      expect(store.sample<number>("topic.c", token)).toBeUndefined();
      expect(store.getTimeline("topic.c").latest()).toBeUndefined();
    });
  });

  describe("frame coherence — memoized reads (Defect 3)", () => {
    it("a mid-frame late sample below viewUt doesn't flip sample() until the next beginFrame()", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);

      // Establish a viewUt of 100 with no points yet on topic "b".
      store.ingest("a", point(100, 1));
      const token = store.beginFrame(); // viewUt frozen at 100

      const firstRead = store.sample<number>("b", token);
      expect(firstRead).toBeUndefined(); // cold: nothing ingested for "b" yet

      // A late out-of-order sample arrives mid-frame, validAt (50) <= viewUt
      // (100) — a fresh, unmemoized `at(100)` read WOULD now find it.
      store.ingest("b", point(50, 777));

      const secondRead = store.sample<number>("b", token);
      expect(secondRead).toBe(firstRead); // frame-coherent: no tearing within the frame

      // The change surfaces only once the frame actually advances.
      const nextToken = store.beginFrame();
      expect(store.sample<number>("b", nextToken)?.payload).toBe(777);
    });

    it("two reads of the same topic within one frame agree even if a listener ingests in between", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);

      store.ingest("c", point(10, 1));
      const token = store.beginFrame(); // viewUt frozen at 10

      const componentOneRead = store.sample<number>("c", token);
      store.ingest("c", point(5, 999)); // late backfill below viewUt
      const componentTwoRead = store.sample<number>("c", token);

      expect(componentTwoRead).toBe(componentOneRead);
      expect(componentOneRead?.payload).toBe(1);
    });
  });

  describe("FrameToken generation validity", () => {
    it("a token cached across beginFrame() calls falls back to the current frame instead of reading a frozen-in-the-past viewUt forever", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);

      store.ingest("x", point(10, 1));
      const staleToken = store.beginFrame(); // viewUt frozen at 10
      expect(store.sample<number>("x", staleToken)?.payload).toBe(1);

      // Frame advances — staleToken is now from a superseded frame.
      store.ingest("x", point(20, 2));
      store.beginFrame(); // new frame, viewUt now 20

      // A caller that held onto staleToken across the frame boundary (a bug
      // on its own) can't use it to read a frozen-in-the-past viewUt
      // forever — it gets routed to the current frame instead.
      const result = store.sample<number>("x", staleToken);
      expect(result?.payload).toBe(2);
    });
  });

  describe("derived channels (T3)", () => {
    /** A trivial derived channel: sums two raw numeric inputs at the frozen viewUt. */
    function sumChannel(spy?: () => void): DerivedChannelDefinition<{
      sum: number;
      viewUtSeenByA: number;
      viewUtSeenByB: number;
    }> {
      return {
        topic: "derived.sum",
        inputs: ["a", "b"],
        fields: true,
        derive: (get, viewUt) => {
          spy?.();
          const a = get<number>("a");
          const b = get<number>("b");
          if (a === undefined || b === undefined) return null;
          return {
            sum: a.payload + b.payload,
            viewUtSeenByA: viewUt,
            viewUtSeenByB: viewUt,
          };
        },
      };
    }

    it("registers a derived channel and reads it through sample() like any raw topic", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);
      store.registerDerivedChannel(sumChannel());

      store.ingest("a", point(10, 2));
      store.ingest("b", point(10, 3));
      store.beginFrame();

      expect(store.sample<{ sum: number }>("derived.sum")?.payload.sum).toBe(5);
    });

    it("single-view-time: get() reads every input at the SAME frozen viewUt the derive call was invoked for", () => {
      const wall = fakeWall();
      const clock = new ViewClock({
        nowWall: wall.now,
        delaySeconds: () => 50,
        warpRate: () => 1,
      });
      const store = new TimelineStore(clock);
      store.registerDerivedChannel(sumChannel());

      store.ingest("a", point(0, 1));
      store.ingest("a", point(100, 2));
      store.ingest("b", point(0, 10));
      store.ingest("b", point(100, 20));
      const token = store.beginFrame(); // viewUt = 100 - 50 = 50

      const result = store.sample<{
        sum: number;
        viewUtSeenByA: number;
        viewUtSeenByB: number;
      }>("derived.sum", token);

      expect(token.viewUt).toBe(50);
      expect(result?.payload.viewUtSeenByA).toBe(50);
      expect(result?.payload.viewUtSeenByB).toBe(50);
      // At viewUt 50, both timelines are still holding their UT-0 point.
      expect(result?.payload.sum).toBe(11);
    });

    it("fields subtopics: a '<topic>.<field>' read exposes one field off the memoized record", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);
      store.registerDerivedChannel(sumChannel());

      store.ingest("a", point(10, 4));
      store.ingest("b", point(10, 5));
      store.beginFrame();

      expect(store.sample<number>("derived.sum.sum")?.payload).toBe(9);
    });

    it("missing input -> the derived value is null, not a fabricated zero", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);
      store.registerDerivedChannel(sumChannel());

      store.ingest("a", point(10, 4));
      // "b" never ingested.
      store.beginFrame();

      expect(store.sample<{ sum: number }>("derived.sum")?.payload).toBeNull();
      // A field subtopic off a null parent is also null, not undefined.
      expect(store.sample<number>("derived.sum.sum")?.payload).toBeNull();
    });

    describe("undefined-vs-null distinction (Critical fix)", () => {
      it("derive returning undefined means 'not whole yet' -> sample() returns undefined, not a tombstone point", () => {
        const clock = new ViewClock({
          delaySeconds: () => 0,
          warpRate: () => 1,
        });
        const store = new TimelineStore(clock);
        store.registerDerivedChannel<{ n: number }>({
          topic: "derived.notWhole",
          inputs: ["a"],
          fields: true,
          derive: (get) => {
            const a = get<number>("a");
            if (a === undefined) return undefined; // input not whole yet
            return { n: a.payload };
          },
        });

        // Nothing ever ingested for "a" — cold start.
        store.beginFrame();

        expect(store.sample<{ n: number }>("derived.notWhole")).toBeUndefined();
        // A field subtopic of a not-whole-yet parent is undefined too, not
        // a field read off a fabricated tombstone.
        expect(store.sample<number>("derived.notWhole.n")).toBeUndefined();
      });

      it("derive returning null still materializes a real tombstone point (payload: null), distinct from undefined", () => {
        const clock = new ViewClock({
          delaySeconds: () => 0,
          warpRate: () => 1,
        });
        const store = new TimelineStore(clock);
        store.registerDerivedChannel<{ n: number }>({
          topic: "derived.tombstone",
          inputs: [],
          derive: () => null,
        });

        store.beginFrame();

        const result = store.sample<{ n: number }>("derived.tombstone");
        expect(result).not.toBeUndefined();
        expect(result?.payload).toBeNull();
      });
    });

    describe("epoch in the derived memo key (mid-frame rewind, Minor fix)", () => {
      it("a mid-frame epoch bump forces the derived memo to recompute rather than serving the pre-bump value for the rest of the frame", () => {
        const clock = new ViewClock({
          delaySeconds: () => 0,
          warpRate: () => 1,
        });
        const store = new TimelineStore(clock);
        const computeSpy = vi.fn();
        let counter = 0;
        store.registerDerivedChannel<{ n: number }>({
          topic: "derived.counter",
          inputs: [],
          derive: () => {
            computeSpy();
            counter += 1;
            return { n: counter };
          },
        });

        const token = store.beginFrame();
        const first = store.sample<{ n: number }>("derived.counter", token);
        expect(first?.payload.n).toBe(1);
        expect(computeSpy).toHaveBeenCalledTimes(1);

        // Quickload rewind mid-frame — epoch bumps via an unrelated topic's
        // ingest, no new beginFrame() yet, so `token` is still current.
        store.ingest("unrelated", point(0, 0, { epoch: 1 }));
        expect(store.clock.getEpoch()).toBe(1);

        const second = store.sample<{ n: number }>("derived.counter", token);

        // Not stale: recomputed (spy called again), not the frozen
        // pre-bump `{ n: 1 }` served for the rest of the frame.
        expect(computeSpy).toHaveBeenCalledTimes(2);
        expect(second?.payload.n).toBe(2);
        expect(second).not.toBe(first);
      });
    });

    describe("memoization", () => {
      it("same frame + unchanged inputs: derive runs exactly once, even across multiple reads and field subtopics", () => {
        const clock = new ViewClock({
          delaySeconds: () => 0,
          warpRate: () => 1,
        });
        const store = new TimelineStore(clock);
        const computeSpy = vi.fn();
        store.registerDerivedChannel(sumChannel(computeSpy));

        store.ingest("a", point(10, 4));
        store.ingest("b", point(10, 5));
        const token = store.beginFrame();

        store.sample("derived.sum", token);
        store.sample("derived.sum", token);
        store.sample("derived.sum.sum", token);
        store.sample("derived.sum.viewUtSeenByA", token);

        expect(computeSpy).toHaveBeenCalledTimes(1);
      });

      it("a new frame recomputes, even with unchanged inputs", () => {
        const clock = new ViewClock({
          delaySeconds: () => 0,
          warpRate: () => 1,
        });
        const store = new TimelineStore(clock);
        const computeSpy = vi.fn();
        store.registerDerivedChannel(sumChannel(computeSpy));

        store.ingest("a", point(10, 4));
        store.ingest("b", point(10, 5));
        store.beginFrame();
        store.sample("derived.sum");
        expect(computeSpy).toHaveBeenCalledTimes(1);

        store.beginFrame(); // no new ingest at all
        store.sample("derived.sum");
        expect(computeSpy).toHaveBeenCalledTimes(2);
      });

      it("an input revision within the same frame does NOT retroactively change an already-memoized read (frame coherence, Defect 3)", () => {
        const clock = new ViewClock({
          delaySeconds: () => 0,
          warpRate: () => 1,
        });
        const store = new TimelineStore(clock);
        const computeSpy = vi.fn();
        store.registerDerivedChannel(sumChannel(computeSpy));

        store.ingest("a", point(10, 4));
        store.ingest("b", point(10, 5));
        const token = store.beginFrame();

        const first = store.sample<{ sum: number }>("derived.sum", token);
        expect(first?.payload.sum).toBe(9);

        store.ingest("a", point(10, 100)); // mid-frame revision bump
        const second = store.sample<{ sum: number }>("derived.sum", token);

        expect(second).toBe(first); // same memoized object, not recomputed
        expect(computeSpy).toHaveBeenCalledTimes(1);

        const nextToken = store.beginFrame();
        const third = store.sample<{ sum: number }>("derived.sum", nextToken);
        expect(third?.payload.sum).toBe(105); // the new frame picks up the revision
        expect(computeSpy).toHaveBeenCalledTimes(2);
      });
    });
  });
});

describe("TimelineStore.resolveSubscriptionTopics — derived-input ref-counting (M2 bridge task, Fix 1 item 3)", () => {
  function makeStore(): TimelineStore {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    return new TimelineStore(clock);
  }

  it("a plain raw topic resolves to itself (identity — nothing to redirect)", () => {
    const store = makeStore();
    expect(store.resolveSubscriptionTopics("vessel.orbit")).toEqual([
      "vessel.orbit",
    ]);
  });

  it("a registered derived channel's own topic resolves to its declared inputs, not itself", () => {
    const store = makeStore();
    store.registerDerivedChannel({
      topic: "vessel.state",
      inputs: ["vessel.orbit", "vessel.flight"],
      fields: true,
      derive: () => null,
    });

    expect(store.resolveSubscriptionTopics("vessel.state").sort()).toEqual(
      ["vessel.flight", "vessel.orbit"].sort(),
    );
  });

  it("a field subtopic of a derived channel resolves to the PARENT channel's inputs", () => {
    const store = makeStore();
    store.registerDerivedChannel({
      topic: "vessel.state",
      inputs: ["vessel.orbit", "vessel.flight"],
      fields: true,
      derive: () => null,
    });

    expect(
      store.resolveSubscriptionTopics("vessel.state.altitudeAsl").sort(),
    ).toEqual(["vessel.flight", "vessel.orbit"].sort());
  });

  it("derived-on-derived: resolves transitively down to genuinely raw topics, deduplicated", () => {
    const store = makeStore();
    store.registerDerivedChannel({
      topic: "derived.inner",
      inputs: ["raw.a", "raw.b"],
      derive: () => null,
    });
    store.registerDerivedChannel({
      topic: "derived.outer",
      inputs: ["derived.inner", "raw.b", "raw.c"],
      derive: () => null,
    });

    expect(store.resolveSubscriptionTopics("derived.outer").sort()).toEqual(
      ["raw.a", "raw.b", "raw.c"].sort(),
    );
  });

  it("a cyclical derived-channel declaration (author bug) does not infinite-loop", () => {
    const store = makeStore();
    store.registerDerivedChannel({
      topic: "derived.x",
      inputs: ["derived.y"],
      derive: () => null,
    });
    store.registerDerivedChannel({
      topic: "derived.y",
      inputs: ["derived.x", "raw.z"],
      derive: () => null,
    });

    expect(store.resolveSubscriptionTopics("derived.x")).toEqual(["raw.z"]);
  });
});

describe("TimelineStore.isUnresolvableField — phantom-field diagnostic (M2 bridge task, Fix 1 item 4)", () => {
  function makeStore(): TimelineStore {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);
    store.registerDerivedChannel<{ real: number }>({
      topic: "derived.thing",
      inputs: ["raw.input"],
      fields: true,
      derive: (get) => {
        const input = get<number>("raw.input");
        if (!input) return undefined;
        if (input.payload === null) return null;
        return { real: input.payload };
      },
    });
    return store;
  }

  it("false while the parent hasn't produced a whole record yet (ordinary loading, not phantom)", () => {
    const store = makeStore();
    store.beginFrame();
    expect(store.isUnresolvableField("derived.thing.ghost")).toBe(false);
  });

  it("false when the parent is tombstoned (confirmed absence, not phantom)", () => {
    const store = makeStore();
    store.ingest("raw.input", point(0, null));
    store.beginFrame();
    expect(store.isUnresolvableField("derived.thing.ghost")).toBe(false);
  });

  it("false for a field the parent's record actually has", () => {
    const store = makeStore();
    store.ingest("raw.input", point(0, 5));
    store.beginFrame();
    expect(store.isUnresolvableField("derived.thing.real")).toBe(false);
  });

  it("true once the parent has a whole record but the requested field is genuinely not on it", () => {
    const store = makeStore();
    store.ingest("raw.input", point(0, 5));
    store.beginFrame();
    expect(store.isUnresolvableField("derived.thing.ghost")).toBe(true);
  });

  it("false for a topic that isn't a dotted field subtopic at all", () => {
    const store = makeStore();
    expect(store.isUnresolvableField("derived.thing")).toBe(false);
  });
});

describe("TimelineStore.isUnresolvableField — RAW-FIELD phantom-mapping diagnostic (M3 whole-branch review #2)", () => {
  /**
   * Before this fix, `isUnresolvableField` only guarded DERIVED-channel
   * parents (`this.derivedChannels.has(parentTopic)` — see the describe
   * block above). A raw record field-subtopic (e.g.
   * `"vessel.resources.resources.<name>.current"` — `resolveRawFieldSubtopic`)
   * fell straight through that guard and always returned `false`, even once
   * its RAW parent had arrived whole and genuinely lacked the field — so a
   * wrong/drifted raw fieldpath served a permanent `undefined` with no
   * legacy fallback (`useDataValue.ts`'s belt-and-suspenders check never
   * fired for it). This mirrors the derived-channel behavior for the raw
   * case: `false` while the parent hasn't arrived (ordinary loading) or is
   * tombstoned (confirmed absence), `true` only once the parent is a whole,
   * live record that genuinely doesn't have the field.
   */
  function rawPoint(
    payload: Record<string, unknown> | null,
  ): TimelinePoint<Record<string, unknown> | null> {
    return {
      validAt: 0,
      payload,
      meta: makeMeta({ validAt: 0, deliveredAt: 0 }),
      epoch: 0,
    };
  }

  it("false while the raw parent hasn't produced a whole record yet (ordinary loading, not phantom)", () => {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    store.beginFrame();
    expect(store.isUnresolvableField("vessel.control.throttle")).toBe(false);
  });

  it("false when the raw parent is tombstoned (confirmed absence, not phantom)", () => {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    store.ingest("vessel.control", rawPoint(null));
    store.beginFrame();
    expect(store.isUnresolvableField("vessel.control.throttle")).toBe(false);
  });

  it("false for a field the raw parent's record actually has", () => {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    store.ingest("vessel.control", rawPoint({ throttle: 0.5 }));
    store.beginFrame();
    expect(store.isUnresolvableField("vessel.control.throttle")).toBe(false);
  });

  it("true once the raw parent has a whole record but the requested field is genuinely not on it (the FuelStatus-class bug)", () => {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    store.ingest("vessel.control", rawPoint({ notThrottle: 0.5 }));
    store.beginFrame();
    expect(store.isUnresolvableField("vessel.control.throttle")).toBe(true);
  });

  it("true for a 2-level nested raw fieldpath whose intermediate segment is genuinely absent", () => {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    store.ingest(
      "vessel.resources",
      rawPoint({ resources: { LiquidFuel: { current: 100 } } }),
    );
    store.beginFrame();
    // Real field genuinely present.
    expect(
      store.isUnresolvableField(
        "vessel.resources.resources.LiquidFuel.current",
      ),
    ).toBe(false);
    // Wrong/drifted resource name — a phantom mapping one layer deeper than
    // the raw-topic root, exactly the class of bug
    // `map-topic.rawFieldResolution.fixture.test.ts` guards against.
    expect(
      store.isUnresolvableField("vessel.resources.resources.Monoprop.current"),
    ).toBe(true);
  });

  it("false for a raw topic with fewer than 3 segments (not a field-subtopic form at all)", () => {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    store.ingest("vessel.orbit", rawPoint({ sma: 700_000 }));
    store.beginFrame();
    expect(store.isUnresolvableField("vessel.orbit")).toBe(false);
  });
});

describe("lerpPayload — angular wrap + discrete-field safety (M2 T5 close-review Fix 3)", () => {
  it("wraps a longitude field the SHORT way around the antimeridian, instead of lerping straight through the planet", () => {
    // 179 -> -179 is a 2-degree hop the short way (through 180/-180), not a
    // ~358-degree hop the naive numeric lerp takes through 0.
    const before = { longitude: 179 };
    const after = { longitude: -179 };
    const result = lerpPayload(before, after, 0.5);
    expect(result).toBeDefined();
    // Naive lerp would give ~0 here — assert we're nowhere near that and
    // instead land on the wrapped short-way midpoint (+-180).
    expect(Math.abs(result?.longitude ?? 0)).toBeGreaterThan(170);
  });

  it("holds the BEFORE value for a discrete/index numeric field (referenceBodyIndex) instead of fractionalizing it", () => {
    const before = { referenceBodyIndex: 1, sma: 700_000 };
    const after = { referenceBodyIndex: 2, sma: 800_000 };
    const result = lerpPayload(before, after, 0.5);
    expect(result).toBeDefined();
    expect(result?.referenceBodyIndex).toBe(1); // hold-last, never 1.5
    expect(result?.sma).toBeCloseTo(750_000); // genuinely continuous field still lerps
  });
});
