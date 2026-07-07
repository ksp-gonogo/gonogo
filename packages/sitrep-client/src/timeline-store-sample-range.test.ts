import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { DerivedChannelDefinition } from "./timeline-store";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * `TimelineStore.sampleRange` (M3 `useDataSeries` shim task) — the range
 * read behind the sparkline/`GraphView` series shim in `@gonogo/data`,
 * mirroring `sample()`'s raw-topic / raw-field-subtopic resolution
 * (`timeline-store-raw-fields.test.ts`) but returning every buffered point
 * in a window instead of a single hold-last read.
 */

function newStore(): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  return new TimelineStore(clock);
}

function orbitPoint(
  sma: number | null,
  validAt: number,
  epoch = 0,
): {
  validAt: number;
  payload: { sma: number } | null;
  meta: ReturnType<typeof makeMeta>;
  epoch: number;
} {
  return {
    validAt,
    payload: sma === null ? null : { sma },
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch,
  };
}

describe("TimelineStore.sampleRange — raw topics", () => {
  it("returns every buffered point on a literal (2-segment) raw topic within the window, payload as-is", () => {
    const store = newStore();
    store.ingest("vessel.orbit", orbitPoint(680_000, 10));
    store.ingest("vessel.orbit", orbitPoint(680_100, 20));
    store.ingest("vessel.orbit", orbitPoint(680_200, 30));

    const points = store.sampleRange<{ sma: number }>("vessel.orbit", 0, 25);
    expect(points).toBeDefined();
    expect(points?.map((p) => p.payload)).toEqual([
      { sma: 680_000 },
      { sma: 680_100 },
    ]);
    expect(points?.map((p) => p.validAt)).toEqual([10, 20]);
  });

  it("returns an empty array (not undefined) when nothing has landed in the window yet", () => {
    const store = newStore();
    expect(store.sampleRange("vessel.orbit", 0, 100)).toEqual([]);
  });
});

describe("TimelineStore.sampleRange — raw record field-subtopics (M3 pilot mechanism)", () => {
  it("extracts the field from every point on the PARENT raw topic's timeline", () => {
    const store = newStore();
    store.ingest("vessel.orbit", orbitPoint(679_400, 10));
    store.ingest("vessel.orbit", orbitPoint(679_800, 20));
    store.ingest("vessel.orbit", orbitPoint(680_000, 30));

    const points = store.sampleRange<number>("vessel.orbit.sma", 0, 30);
    expect(points?.map((p) => p.payload)).toEqual([679_400, 679_800, 680_000]);
    // validAt is carried through from the parent record's own point.
    expect(points?.map((p) => p.validAt)).toEqual([10, 20, 30]);
  });

  it("skips a tombstoned parent point rather than fabricating a field value", () => {
    const store = newStore();
    store.ingest("vessel.orbit", orbitPoint(679_400, 10));
    store.ingest("vessel.orbit", orbitPoint(null, 20));
    store.ingest("vessel.orbit", orbitPoint(680_000, 30));

    const points = store.sampleRange<number>("vessel.orbit.sma", 0, 30);
    expect(points?.map((p) => p.payload)).toEqual([679_400, 680_000]);
  });

  it("skips a point whose parent record lacks the field entirely", () => {
    const store = newStore();
    store.ingest("vessel.orbit", orbitPoint(679_400, 10));
    // A record shape with no 'sma' key at all.
    store.ingest("vessel.orbit", {
      validAt: 20,
      payload: { ecc: 0.01 },
      meta: makeMeta({ validAt: 20, deliveredAt: 20 }),
      epoch: 0,
    });

    const points = store.sampleRange<number>("vessel.orbit.sma", 0, 30);
    expect(points?.map((p) => p.payload)).toEqual([679_400]);
  });

  it("resolves a 2-level nested field path, mirroring vessel.thermal.hottestPart.skinTemp", () => {
    const store = newStore();
    store.ingest("vessel.thermal", {
      validAt: 0,
      payload: { hottestPart: { skinTemp: 450.5 } },
      meta: makeMeta({ validAt: 0, deliveredAt: 0 }),
      epoch: 0,
    });
    store.ingest("vessel.thermal", {
      validAt: 10,
      payload: { hottestPart: { skinTemp: 460 } },
      meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
      epoch: 0,
    });

    const points = store.sampleRange<number>(
      "vessel.thermal.hottestPart.skinTemp",
      0,
      10,
    );
    expect(points?.map((p) => p.payload)).toEqual([450.5, 460]);
  });
});

describe("TimelineStore.sampleRange — derived topics are unsupported", () => {
  const doubler: DerivedChannelDefinition<number> = {
    topic: "derived.double",
    inputs: ["raw.x"],
    derive: (get) => {
      const point = get<number>("raw.x");
      return point ? point.payload * 2 : undefined;
    },
  };

  it("returns undefined for a registered derived channel's own topic — no stored history to range over", () => {
    const store = newStore();
    store.registerDerivedChannel(doubler);
    store.ingest("raw.x", {
      validAt: 0,
      payload: 5,
      meta: makeMeta({ validAt: 0, deliveredAt: 0 }),
      epoch: 0,
    });

    expect(store.sampleRange("derived.double", 0, 100)).toBeUndefined();
  });

  it("isDerivedTopic reports true for a derived topic and false for a raw one", () => {
    const store = newStore();
    store.registerDerivedChannel(doubler);
    expect(store.isDerivedTopic("derived.double")).toBe(true);
    expect(store.isDerivedTopic("vessel.orbit")).toBe(false);
    expect(store.isDerivedTopic("vessel.orbit.sma")).toBe(false);
  });
});

describe("TimelineStore.sampleRange — epoch guard", () => {
  it("a pre-rewind (lower-epoch) timeline reads as empty, never serving dead-epoch history", () => {
    const store = newStore();
    store.ingest("vessel.orbit", orbitPoint(679_000, 10, 0));
    store.ingest("vessel.orbit", orbitPoint(680_000, 20, 0));
    // Quickload rewind bumps the epoch.
    store.ingest("vessel.orbit", orbitPoint(500_000, 5, 1));

    // The post-rewind epoch-1 point IS in range.
    expect(store.sampleRange<{ sma: number }>("vessel.orbit", 0, 30)).toEqual([
      {
        validAt: 5,
        payload: { sma: 500_000 },
        meta: expect.anything(),
        epoch: 1,
      },
    ]);
  });
});
