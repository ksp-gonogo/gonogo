import { afterEach, describe, expect, it } from "vitest";
import type { ReckonerDefinition } from "./reading";
import { clearReckoners, registerReckoner } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { DerivedChannelDefinition } from "./timeline-store";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * `TimelineStore.sampleReckonedTail`: the part of a series nobody measured.
 *
 * `sampleDerivedRange` next door emits a point only where a declared INPUT
 * changed, which is the whole of history and none of the silence after it.
 * These cases isolate the tail mechanism against small synthetic channels; the
 * full `vessel.state` path runs end to end in `@ksp-gonogo/data`'s
 * `useDataSeries.reckoned.test.tsx` and on a rendered chart in
 * `@ksp-gonogo/components`' `Graph/stream.test.tsx`.
 */

function newStore(viewUt: number): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  clock.scrubTo(viewUt);
  const store = new TimelineStore(clock);
  store.beginFrame();
  return store;
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

afterEach(() => clearReckoners());

/** A ramp: the value IS a function of the view time, which is what a model is. */
const RAMP: DerivedChannelDefinition<{ level: number; armed: boolean }> = {
  topic: "derived.ramp",
  inputs: ["raw.x"],
  derive: (get, viewUt) => {
    const point = get<number>("raw.x");
    if (!point) return undefined;
    if (point.payload === null) return null;
    return { level: point.payload + (viewUt - point.validAt), armed: true };
  },
  deriveReckoning: () => "rate-integration",
  fields: true,
};

/** Declines past a fixed instant, the shape a real horizon takes. */
const BOUNDED: DerivedChannelDefinition<{ level: number }> = {
  topic: "derived.bounded",
  inputs: ["raw.x"],
  derive: (get, viewUt) => {
    const point = get<number>("raw.x");
    if (!point || point.payload === null) return undefined;
    return { level: point.payload + (viewUt - point.validAt) };
  },
  deriveReckoning: (_get, viewUt) =>
    viewUt < 40 ? "kepler-propagation" : undefined,
  fields: true,
};

/**
 * Names the paths its model moves rather than claiming the record.
 *
 * `carried` is on the record and is not one of them: it is what a channel does
 * when it holds a field off an input nothing propagated.
 */
const PER_FIELD: DerivedChannelDefinition<{
  moved: number;
  carried: number;
}> = {
  topic: "derived.perfield",
  inputs: ["raw.x"],
  derive: (get, viewUt) => {
    const point = get<number>("raw.x");
    if (!point || point.payload === null) return undefined;
    return { moved: point.payload + (viewUt - point.validAt), carried: 42 };
  },
  deriveReckoning: () => [
    { path: "", basis: "kepler-propagation" },
    { path: "moved", basis: "kepler-propagation" },
  ],
  fields: true,
};

/** A channel with no model at all: the default, and it must stay silent. */
const UNMODELLED: DerivedChannelDefinition<{ level: number }> = {
  topic: "derived.unmodelled",
  inputs: ["raw.x"],
  derive: (get) => {
    const point = get<number>("raw.x");
    if (!point || point.payload === null) return undefined;
    return { level: point.payload };
  },
  fields: true,
};

describe("TimelineStore.sampleReckonedTail", () => {
  it("answers with nothing for a topic that is not a derived channel", () => {
    const store = newStore(100);
    ingestPoint(store, "raw.x", 10, 5);
    expect(store.sampleReckonedTail("raw.x", 0, 100)).toEqual([]);
  });

  it("answers with nothing for a channel that declares no model", () => {
    const store = newStore(100);
    store.registerDerivedChannel(UNMODELLED);
    ingestPoint(store, "raw.x", 10, 5);
    expect(
      store.sampleReckonedTail("derived.unmodelled.level", 0, 100),
    ).toEqual([]);
  });

  it("carries a modelled field past the last observation, to the view time", () => {
    const store = newStore(50);
    store.registerDerivedChannel(RAMP);
    ingestPoint(store, "raw.x", 10, 0);
    ingestPoint(store, "raw.x", 20, 0);
    ingestPoint(store, "raw.x", 30, 0);

    const tail = store.sampleReckonedTail<number>("derived.ramp.level", 0, 50);
    expect(tail.length).toBeGreaterThan(0);
    // Every instant is AFTER the newest observation and none is past the view
    // time: the tail is the silence, never a second opinion about history.
    expect(tail.every((s) => s.atUt > 30 && s.atUt <= 50)).toBe(true);
    // It reaches the view time exactly, which is the moment the frame draws for.
    expect(tail[tail.length - 1].atUt).toBe(50);
    // The value is the MODEL's, not the last observation held flat.
    expect(tail[tail.length - 1].value).toBe(20);
    expect(tail.every((s) => s.basis === "rate-integration")).toBe(true);
  });

  it("samples the tail at the cadence the observations were arriving at", () => {
    const store = newStore(50);
    store.registerDerivedChannel(RAMP);
    ingestPoint(store, "raw.x", 10, 0);
    ingestPoint(store, "raw.x", 20, 0);
    ingestPoint(store, "raw.x", 30, 0);

    const tail = store.sampleReckonedTail<number>("derived.ramp.level", 0, 50);
    expect(tail.map((s) => s.atUt)).toEqual([40, 50]);
  });

  it("stops where the model withdraws, and draws nothing past its horizon", () => {
    const store = newStore(100);
    store.registerDerivedChannel(BOUNDED);
    ingestPoint(store, "raw.x", 10, 0);
    ingestPoint(store, "raw.x", 20, 0);

    const tail = store.sampleReckonedTail<number>(
      "derived.bounded.level",
      0,
      100,
    );
    // The stride is 10, so the walk offers 30 and 40; 40 is past the horizon.
    expect(tail.map((s) => s.atUt)).toEqual([30]);
  });

  it("draws no tail while the newest observation IS the view time", () => {
    const store = newStore(30);
    store.registerDerivedChannel(RAMP);
    ingestPoint(store, "raw.x", 10, 0);
    ingestPoint(store, "raw.x", 30, 0);
    expect(store.sampleReckonedTail("derived.ramp.level", 0, 30)).toEqual([]);
  });

  it("declines a field a line cannot honestly draw, and the whole record too", () => {
    const store = newStore(50);
    store.registerDerivedChannel(RAMP);
    ingestPoint(store, "raw.x", 10, 0);
    ingestPoint(store, "raw.x", 20, 0);

    // A boolean is a state, not a quantity: joining two of them draws a slope
    // through values that do not exist.
    expect(store.sampleReckonedTail("derived.ramp.armed", 0, 50)).toEqual([]);
    // And a whole record is not a series at all.
    expect(store.sampleReckonedTail("derived.ramp", 0, 50)).toEqual([]);
  });

  it("carries only a path the model NAMES, where the channel names any", () => {
    const store = newStore(50);
    store.registerDerivedChannel(PER_FIELD);
    ingestPoint(store, "raw.x", 10, 0);
    ingestPoint(store, "raw.x", 20, 0);
    ingestPoint(store, "raw.x", 30, 0);

    expect(
      store
        .sampleReckonedTail<number>("derived.perfield.moved", 0, 50)
        .map((s) => s.atUt),
    ).toEqual([40, 50]);
    // Named nowhere in the model's list. The root entry says the RECORD is
    // forward-modelled, which is what a readout beside an age asks and not what
    // a line passing through every instant asks.
    expect(store.sampleReckonedTail("derived.perfield.carried", 0, 50)).toEqual(
      [],
    );
  });

  it("keeps its answer stable within one frame and re-derives across frames", () => {
    const store = newStore(50);
    store.registerDerivedChannel(RAMP);
    ingestPoint(store, "raw.x", 10, 0);
    ingestPoint(store, "raw.x", 30, 0);

    const first = store.sampleReckonedTail("derived.ramp.level", 0, 50);
    expect(store.sampleReckonedTail("derived.ramp.level", 0, 50)).toBe(first);
    store.beginFrame();
    expect(store.sampleReckonedTail("derived.ramp.level", 0, 50)).not.toBe(
      first,
    );
  });
});

/**
 * A store whose view clock is free to run ahead of the newest sample, the
 * `reckoning-gaps.test.ts` recipe: in confirmed mode the clock clamps to the
 * newest delivered sample, so there is no silence to carry anything across.
 */
function disconnectedStore(nowSeconds: number): TimelineStore {
  const clock = new ViewClock({
    nowWall: () => nowSeconds,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.setMode("predicted");
  const store = new TimelineStore(clock);
  return store;
}

/**
 * The other model registry: what an Uplink registers for a RAW topic.
 *
 * It reaches the point layer through `sampleReading` and reached nothing else
 * until this producer existed, so an author's model drew a propagated marker
 * and left a plot of the same quantity ending mid-window with nothing to say
 * that was deliberate. The cases here are the derived ones above asked again
 * through the other rung of the ladder, so the horizon rule and the continuity
 * rule are demonstrably one implementation rather than two that agree today.
 */
describe("TimelineStore.sampleReckonedTail: a registered reckoner", () => {
  it("carries a raw topic forward on the model its owner registered", () => {
    const store = disconnectedStore(50);
    registerReckoner<number>("temperature", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at: number) =>
          (point.payload as number) + (at - point.validAt),
      }),
    });
    ingestPoint(store, "temperature", 10, 0);
    ingestPoint(store, "temperature", 20, 0);
    ingestPoint(store, "temperature", 30, 0);
    store.setTransportConnected(false);
    store.beginFrame();

    const tail = store.sampleReckonedTail<number>("temperature", 0, 50);
    expect(tail.map((s) => s.atUt)).toEqual([40, 50]);
    expect(tail.map((s) => s.value)).toEqual([10, 20]);
    expect(tail.every((s) => s.basis === "rate-integration")).toBe(true);
  });

  it("stops where the owner's model withdraws", () => {
    const store = disconnectedStore(100);
    const HORIZON = 15;
    const reckoner: ReckonerDefinition<number> = {
      deps: [],
      reckon: (point, _deps, { viewUt: at }) => {
        if (at - point.validAt > HORIZON)
          return { declined: { reason: "beyond-horizon" } };
        return {
          modelled: [{ path: "", basis: "linear-dead-reckoning" }],
          reckon: () => point.payload as number,
        };
      },
    };
    registerReckoner("temperature", "test", reckoner);
    ingestPoint(store, "temperature", 10, 5);
    ingestPoint(store, "temperature", 20, 5);
    store.setTransportConnected(false);
    store.beginFrame();

    // The stride is 10, so the walk offers 30 and 40; 40 is 20 s past the
    // observation, which is beyond the horizon this model claims.
    expect(
      store
        .sampleReckonedTail<number>("temperature", 0, 100)
        .map((s) => s.atUt),
    ).toEqual([30]);
  });

  it("draws nothing for a model that declines outright", () => {
    const store = disconnectedStore(50);
    registerReckoner<number>("temperature", "test", {
      deps: [],
      reckon: () => ({ declined: { reason: "model-inapplicable" } }),
    });
    ingestPoint(store, "temperature", 10, 5);
    ingestPoint(store, "temperature", 20, 5);
    store.setTransportConnected(false);
    store.beginFrame();

    expect(store.sampleReckonedTail("temperature", 0, 50)).toEqual([]);
  });

  it("draws nothing while the topic is live, where there is no silence", () => {
    const store = disconnectedStore(50);
    registerReckoner<number>("temperature", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => point.payload as number,
      }),
    });
    ingestPoint(store, "temperature", 10, 5);
    ingestPoint(store, "temperature", 20, 5);
    store.beginFrame();

    expect(store.sampleReckonedTail("temperature", 0, 50)).toEqual([]);
  });
});
