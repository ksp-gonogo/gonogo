import "./reckoner-test-topics";
import { afterEach, describe, expect, it } from "vitest";
import type { ReckonerDefinition } from "./reading";
import { clearReckoners, registerReckoner } from "./reckoners";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * `TimelineStore.sampleReckonedTail`: the part of a series nobody measured.
 *
 * `sampleRange` emits a point only where an observation arrived, which is the
 * whole of history and none of the silence after it. These cases isolate the
 * tail mechanism against a registered reckoner on a synthetic topic; a real
 * topic's tail runs end to end in `@ksp-gonogo/data`'s
 * `useDataSeries.reckoned.test.tsx` and on a rendered chart in
 * `@ksp-gonogo/components`' `Graph/stream.test.tsx`.
 *
 * The synthetic channel is `test.temperature`, declared in
 * `reckoner-test-topics.ts`: `registerReckoner` takes `TopicId` now, so a topic
 * a suite invents has to be declared like any other rather than passed as a
 * bare string.
 */

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
 * What an Uplink registers for a RAW topic reaches a plotted tail as well as the
 * point layer, so an author's model that draws a propagated marker also carries
 * a plot of the same quantity to the view time.
 */
describe("TimelineStore.sampleReckonedTail: a registered reckoner", () => {
  it("carries a raw topic forward on the model its owner registered", () => {
    const store = disconnectedStore(50);
    registerReckoner("test.temperature", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at: number) =>
          (point.payload as number) + (at - point.validAt),
      }),
    });
    ingestPoint(store, "test.temperature", 10, 0);
    ingestPoint(store, "test.temperature", 20, 0);
    ingestPoint(store, "test.temperature", 30, 0);
    store.setTransportConnected(false);
    store.beginFrame();

    const tail = store.sampleReckonedTail<number>("test.temperature", 0, 50);
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
    registerReckoner("test.temperature", "test", reckoner);
    ingestPoint(store, "test.temperature", 10, 5);
    ingestPoint(store, "test.temperature", 20, 5);
    store.setTransportConnected(false);
    store.beginFrame();

    // The stride is 10, so the walk offers 30 and 40; 40 is 20 s past the
    // observation, which is beyond the horizon this model claims.
    expect(
      store
        .sampleReckonedTail<number>("test.temperature", 0, 100)
        .map((s) => s.atUt),
    ).toEqual([30]);
  });

  it("draws nothing for a model that declines outright", () => {
    const store = disconnectedStore(50);
    registerReckoner("test.temperature", "test", {
      deps: [],
      reckon: () => ({ declined: { reason: "model-inapplicable" } }),
    });
    ingestPoint(store, "test.temperature", 10, 5);
    ingestPoint(store, "test.temperature", 20, 5);
    store.setTransportConnected(false);
    store.beginFrame();

    expect(store.sampleReckonedTail("test.temperature", 0, 50)).toEqual([]);
  });

  it("answers with nothing for a topic nothing models", () => {
    const store = disconnectedStore(50);
    ingestPoint(store, "test.temperature", 10, 5);
    ingestPoint(store, "test.temperature", 20, 5);
    store.setTransportConnected(false);
    store.beginFrame();

    expect(store.sampleReckonedTail("test.temperature", 0, 50)).toEqual([]);
  });

  it("declines a field a line cannot honestly draw, and the whole record too", () => {
    const store = disconnectedStore(50);
    registerReckoner("test.contact", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at: number) => ({
          relativePosition:
            (point.payload as { relativePosition: number }).relativePosition +
            (at - point.validAt),
          name: "Mun",
        }),
      }),
    });
    const contact = { relativePosition: 0, name: "Mun" };
    ingestPoint(store, "test.contact", 10, contact);
    ingestPoint(store, "test.contact", 20, contact);
    store.setTransportConnected(false);
    store.beginFrame();

    // The numeric field draws, which is what makes the two refusals below
    // statements about shape rather than a walk that never ran.
    expect(
      store
        .sampleReckonedTail<number>("test.contact.relativePosition", 0, 50)
        .map((s) => s.atUt),
    ).toEqual([30, 40, 50]);
    // A name is not a quantity: joining two of them draws a slope through
    // values that do not exist.
    expect(store.sampleReckonedTail("test.contact.name", 0, 50)).toEqual([]);
    // And a whole record is not a series at all.
    expect(store.sampleReckonedTail("test.contact", 0, 50)).toEqual([]);
  });

  it("keeps its answer stable within one frame and walks again across frames", () => {
    const store = disconnectedStore(50);
    registerReckoner("test.temperature", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at: number) =>
          (point.payload as number) + (at - point.validAt),
      }),
    });
    ingestPoint(store, "test.temperature", 10, 0);
    ingestPoint(store, "test.temperature", 30, 0);
    store.setTransportConnected(false);
    store.beginFrame();

    const first = store.sampleReckonedTail("test.temperature", 0, 50);
    expect(first.length).toBeGreaterThan(0);
    expect(store.sampleReckonedTail("test.temperature", 0, 50)).toBe(first);
    store.beginFrame();
    expect(store.sampleReckonedTail("test.temperature", 0, 50)).not.toBe(first);
  });

  it("draws nothing while the topic is live, where there is no silence", () => {
    const store = disconnectedStore(50);
    registerReckoner("test.temperature", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => point.payload as number,
      }),
    });
    ingestPoint(store, "test.temperature", 10, 5);
    ingestPoint(store, "test.temperature", 20, 5);
    store.beginFrame();

    expect(store.sampleReckonedTail("test.temperature", 0, 50)).toEqual([]);
  });
});
