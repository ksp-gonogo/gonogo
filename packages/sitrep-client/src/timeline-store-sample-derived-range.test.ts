import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { DerivedChannelDefinition } from "./timeline-store";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * `TimelineStore.sampleDerivedRange` — the derived-topic counterpart to
 * `sampleRange` (`timeline-store-sample-range.test.ts`), behind
 * `@ksp-gonogo/data`'s `useDataSeries` shim
 * (`useDataSeries.shim.test.tsx`'s own DERIVED-topic test exercises the
 * full `vessel.state` channel end to end; these tests isolate the REPLAY
 * mechanism itself against small synthetic channels).
 */

function newStore(): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  return new TimelineStore(clock);
}

function ingestPoint(
  store: TimelineStore,
  topic: string,
  validAt: number,
  payload: unknown,
): void {
  store.ingest(topic, {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  });
}

const DOUBLER: DerivedChannelDefinition<number> = {
  topic: "derived.double",
  inputs: ["raw.x"],
  derive: (get) => {
    const point = get<number>("raw.x");
    if (!point) return undefined;
    if (point.payload === null) return null;
    return point.payload * 2;
  },
};

const JOINED_SUM: DerivedChannelDefinition<{ sum: number; count: number }> = {
  topic: "derived.joined",
  inputs: ["raw.a", "raw.b"],
  derive: (get) => {
    const a = get<number>("raw.a");
    const b = get<number>("raw.b");
    if (!a || !b) return undefined;
    if (a.payload === null || b.payload === null) return null;
    return { sum: a.payload + b.payload, count: 2 };
  },
  fields: true,
};

describe("TimelineStore.sampleDerivedRange — single-input replay", () => {
  it("returns undefined for a topic that isn't a registered derived channel", () => {
    const store = newStore();
    expect(store.sampleDerivedRange("raw.x", 0, 100)).toBeUndefined();
  });

  it("replays derive() at every UT the raw input changed within the window", () => {
    const store = newStore();
    store.registerDerivedChannel(DOUBLER);
    ingestPoint(store, "raw.x", 10, 5);
    ingestPoint(store, "raw.x", 20, 7);
    ingestPoint(store, "raw.x", 30, 9);

    const points = store.sampleDerivedRange<number>("derived.double", 0, 30);
    expect(points).toBeDefined();
    expect(points?.map((p) => p.validAt)).toEqual([10, 20, 30]);
    expect(points?.map((p) => p.payload)).toEqual([10, 14, 18]);
  });

  it("trims to the requested window, same as sampleRange", () => {
    const store = newStore();
    store.registerDerivedChannel(DOUBLER);
    ingestPoint(store, "raw.x", 10, 1);
    ingestPoint(store, "raw.x", 950, 2);
    ingestPoint(store, "raw.x", 1000, 3);

    const points = store.sampleDerivedRange<number>(
      "derived.double",
      900,
      1000,
    );
    expect(points?.map((p) => p.validAt)).toEqual([950, 1000]);
    expect(points?.map((p) => p.payload)).toEqual([4, 6]);
  });

  it("holds the last value from BEFORE the window so the first in-window instant still resolves", () => {
    const store = newStore();
    store.registerDerivedChannel(DOUBLER);
    ingestPoint(store, "raw.x", 5, 100); // before the window entirely
    ingestPoint(store, "raw.x", 60, 1); // inside the window — the only change point

    const points = store.sampleDerivedRange<number>("derived.double", 50, 100);
    // The only in-window CHANGE instant is validAt 60 — the hold-last value
    // from validAt 5 is what `derive()` reads there, not a fabricated point
    // at validAt 5 itself (which is outside the window).
    expect(points?.map((p) => p.validAt)).toEqual([60]);
    expect(points?.map((p) => p.payload)).toEqual([2]);
  });

  it("omits an instant where derive() returns undefined (input not whole yet at that UT)", () => {
    const store = newStore();
    store.registerDerivedChannel(DOUBLER);
    // No raw.x point at all before validAt 20 — derive() can't resolve
    // anything before its first point lands.
    ingestPoint(store, "raw.x", 20, 3);

    const points = store.sampleDerivedRange<number>("derived.double", 0, 20);
    expect(points?.map((p) => p.validAt)).toEqual([20]);
  });

  it("emits a null payload for a confirmed tombstone, not a fabricated zero", () => {
    const store = newStore();
    store.registerDerivedChannel(DOUBLER);
    ingestPoint(store, "raw.x", 10, 5);
    ingestPoint(store, "raw.x", 20, null);

    const points = store.sampleDerivedRange<number | null>(
      "derived.double",
      0,
      20,
    );
    expect(points?.map((p) => p.payload)).toEqual([10, null]);
  });

  it("returns an empty array (not undefined) when the raw input hasn't landed at all", () => {
    const store = newStore();
    store.registerDerivedChannel(DOUBLER);
    expect(store.sampleDerivedRange("derived.double", 0, 100)).toEqual([]);
  });
});

describe("TimelineStore.sampleDerivedRange — multi-input join + field subtopics", () => {
  it("replays at the union of BOTH inputs' change instants", () => {
    const store = newStore();
    store.registerDerivedChannel(JOINED_SUM);
    ingestPoint(store, "raw.a", 10, 1);
    ingestPoint(store, "raw.b", 15, 10);
    ingestPoint(store, "raw.a", 25, 2);

    // Union of change instants: 10 (a alone, b not whole yet -> skipped),
    // 15 (b changes, a holds 1), 25 (a changes, b holds 10).
    const points = store.sampleDerivedRange<{ sum: number }>(
      "derived.joined",
      0,
      25,
    );
    expect(points?.map((p) => p.validAt)).toEqual([15, 25]);
    expect(points?.map((p) => p.payload.sum)).toEqual([11, 12]);
  });

  it("extracts a single field via the fields:true field-subtopic mechanism", () => {
    const store = newStore();
    store.registerDerivedChannel(JOINED_SUM);
    ingestPoint(store, "raw.a", 10, 1);
    ingestPoint(store, "raw.b", 10, 10);
    ingestPoint(store, "raw.a", 20, 5);

    const points = store.sampleDerivedRange<number>(
      "derived.joined.sum",
      0,
      20,
    );
    expect(points?.map((p) => p.validAt)).toEqual([10, 20]);
    expect(points?.map((p) => p.payload)).toEqual([11, 15]);
  });
});
