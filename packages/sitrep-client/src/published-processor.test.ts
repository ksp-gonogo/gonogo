import { describe, expect, it, vi } from "vitest";
import { processorRuntimeFor } from "./processorEvaluator";
import {
  clearProcessors,
  defineProcessor,
  getPublishedProcessors,
  getPublishedTopicConflicts,
  publishedDefinitionOf,
} from "./processors";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function makeStore(): TimelineStore {
  return new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
}

function ingest(
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

type Deps = readonly [number | null | undefined];

describe("a processor published as a Topic", () => {
  it("runs compute once for a Topic read and a handle read in one frame", () => {
    clearProcessors();
    const spy = vi.fn(([n]: Deps) => (n == null ? n : { doubled: n * 2 }));
    const handle = defineProcessor({
      id: "doubled",
      owner: "test",
      topic: "test.doubled",
      fields: true,
      deps: ["raw.n" as never],
      compute: spy as never,
    });
    const store = makeStore();
    store.publishProcessor(publishedDefinitionOf(handle));
    ingest(store, "raw.n", 5, 4);
    const runtime = processorRuntimeFor(store);
    const release = runtime.activate(handle.id);
    spy.mockClear();

    store.beginFrame();
    const point = store.sample<{ doubled: number }>("test.doubled");
    const field = store.sample<number>("test.doubled.doubled");

    expect(point?.payload).toEqual({ doubled: 8 });
    expect(field?.payload).toBe(8);
    expect(runtime.value(handle.id)).toEqual({ doubled: 8 });
    expect(spy).toHaveBeenCalledTimes(1);
    release();
  });

  it("keeps undefined and null apart, and takes its age from its oldest input", () => {
    const store = makeStore();
    store.publishProcessor({
      topic: "test.sum",
      deps: ["raw.a", "raw.b"],
      compute: ([a, b]: readonly [
        number | null | undefined,
        number | null | undefined,
      ]) => {
        if (a === undefined || b === undefined) return undefined;
        if (a === null || b === null) return null;
        return a + b;
      },
    });

    store.beginFrame();
    expect(store.sample("test.sum")).toBeUndefined();

    ingest(store, "raw.a", 10, 1);
    ingest(store, "raw.b", 30, null);
    store.beginFrame();
    expect(store.sample("test.sum")?.payload).toBeNull();

    ingest(store, "raw.b", 40, 2);
    store.beginFrame();
    const point = store.sample<number>("test.sum");
    expect(point?.payload).toBe(3);
    expect(point?.validAt).toBe(10);
  });

  it("replays history through a nested processor and hands a reading dep as observed", () => {
    clearProcessors();
    const inner = defineProcessor({
      id: "inner",
      owner: "test",
      deps: ["raw.n" as never],
      compute: ([n]: readonly [unknown]) => Number(n) + 1,
    });
    const store = makeStore();
    store.publishProcessor({
      topic: "test.outer",
      deps: [inner, { reading: "raw.n" as never }],
      compute: ([plusOne, reading]: readonly [
        number,
        { state: string; value: number },
      ]) => ({ plusOne, state: reading.state, value: reading.value }),
    });
    ingest(store, "raw.n", 10, 1);
    ingest(store, "raw.n", 20, 2);

    const points = store.sampleProcessorRange<{
      plusOne: number;
      state: string;
      value: number;
    }>("test.outer", 0, 20);

    expect(points?.map((p) => p.payload)).toEqual([
      { plusOne: 2, state: "observed", value: 1 },
      { plusOne: 3, state: "observed", value: 2 },
    ]);
  });
});

describe("who publishes a Topic", () => {
  const compute = () => 1;
  const claim = (owner: string, topic: string, fn = compute) =>
    defineProcessor({ id: "p", owner, topic, deps: [], compute: fn });

  it("withholds a Topic two Uplinks claim and reports the conflict", () => {
    clearProcessors();
    claim("alpha", "shared.topic");
    claim("beta", "shared.topic", () => 2);
    expect(getPublishedProcessors()).toEqual([]);
    expect(getPublishedTopicConflicts()).toEqual([
      { topic: "shared.topic", owners: ["alpha", "beta"] },
    ]);
  });

  it("gives Gonogo's own a Topic an Uplink also claims", () => {
    clearProcessors();
    claim("core", "system.state");
    claim("alpha", "system.state", () => 2);
    expect(getPublishedProcessors().map((def) => def.owner)).toEqual(["core"]);
    expect(getPublishedTopicConflicts()).toEqual([]);
  });
});
