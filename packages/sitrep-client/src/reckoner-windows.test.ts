import { beforeEach, describe, expect, it } from "vitest";
import type { TestContact } from "./reckoner-test-topics";
import { clearReckoners, registerReckoner } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * What a reckoner can SEE of its own topic, and of its inputs.
 *
 * A reckoner used to be handed exactly one point, and that narrowing is why so
 * little was reckonable: a model that wants a trend could not take one, so every
 * changing quantity needed a companion rate field published beside it before
 * anything could carry it forward. A declared window replaces it.
 *
 * Every case here is about what arrives at `reckon`, not about the arithmetic a
 * model does with it, because the mechanism is the thing that was missing.
 * `reckoning-gaps.test.ts` owns the questions about carrying a value across a
 * blackout and `reckoning-field-scope.test.ts` the ones about which fields a
 * model may claim.
 */

function fakeWall(start = 0) {
  let now = start;
  return {
    now: () => now,
    advanceBy: (seconds: number) => {
      now += seconds;
    },
  };
}

/** A store whose view clock is free to run ahead of the newest sample. */
function predictedStore(wall: { now: () => number }) {
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.setMode("predicted");
  return new TimelineStore(clock);
}

function numberPoint(
  validAt: number,
  payload: number | null,
  overrides: Partial<ReturnType<typeof makeMeta>> = {},
): TimelinePoint<number> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt, ...overrides }),
    epoch: 0,
  };
}

/**
 * A run of temperature samples, one every ten UT seconds from `startUt`.
 *
 * Ten seconds is the spacing this fixture happens to write, and nothing under
 * test may depend on it: the stream is change-gated, so a real topic carries a
 * point when its value changed and at no other time. Every assertion below
 * counts points or names their `validAt`, never an interval.
 */
function ingestRun(
  store: TimelineStore,
  startUt: number,
  count: number,
  step = 10,
) {
  for (let i = 0; i < count; i++) {
    store.ingest("test.temperature", numberPoint(startUt + i * step, 100 + i));
  }
}

beforeEach(clearReckoners);

describe("a reckoner's own window", () => {
  it("is one sample when no window is declared, so an existing model is unchanged", () => {
    const store = predictedStore(fakeWall());
    let seen: readonly TimelinePoint<number>[] = [];
    registerReckoner("test.temperature", "test", {
      deps: [],
      reckon(point, _resolved, frame) {
        seen = frame.history;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 5);
    store.beginFrame();
    store.sampleReading<number>("test.temperature");

    expect(seen.map((p) => p.validAt)).toEqual([140]);
  });

  it("hands back the declared span, oldest first, ending at the observation", () => {
    const store = predictedStore(fakeWall());
    let seen: readonly TimelinePoint<number>[] = [];
    registerReckoner("test.temperature", "test", {
      deps: [],
      window: { spanUt: 25, maxSamples: 16 },
      reckon(point, _resolved, frame) {
        seen = frame.history;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 5); // 100, 110, 120, 130, 140
    store.beginFrame();
    store.sampleReading<number>("test.temperature");

    // 25 seconds back from the newest observation at 140.
    expect(seen.map((p) => p.validAt)).toEqual([120, 130, 140]);
  });

  it("measures the span back from the observation, not from the view time", () => {
    /*
     * The whole point of reckoning is to carry a value across a silence, so a
     * window anchored on the frame's view time would empty out precisely when
     * the model was needed: twenty minutes into a blackout, the last minute of
     * contact would be outside it and the model would have nothing to take a
     * rate from.
     */
    const wall = fakeWall();
    const store = predictedStore(wall);
    let seen: readonly TimelinePoint<number>[] = [];
    registerReckoner("test.temperature", "test", {
      deps: [],
      window: { spanUt: 25, maxSamples: 16 },
      reckon(point, _resolved, frame) {
        seen = frame.history;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 5);
    wall.advanceBy(1200);
    store.setTransportConnected(false);
    store.beginFrame();
    store.sampleReading<number>("test.temperature");

    expect(seen.map((p) => p.validAt)).toEqual([120, 130, 140]);
  });

  it("thins a fuller window to the cap and runs anyway, keeping both ends", () => {
    // `maxSamples` is a COST cap, never a rejection: too many points is not a
    // reason to refuse to model, it is a reason to look at fewer of them.
    const store = predictedStore(fakeWall());
    let seen: readonly TimelinePoint<number>[] = [];
    let ran = false;
    registerReckoner("test.temperature", "test", {
      deps: [],
      window: { spanUt: 1000, maxSamples: 3 },
      reckon(point, _resolved, frame) {
        seen = frame.history;
        ran = true;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 9); // 100 .. 180
    store.beginFrame();
    store.sampleReading<number>("test.temperature");

    expect(ran).toBe(true);
    expect(seen).toHaveLength(3);
    expect(seen[0].validAt).toBe(100);
    expect(seen[seen.length - 1].validAt).toBe(180);
  });
});

describe("minSamples is the only rejection, and it is the store's", () => {
  it("never runs the model when the window holds too few points", () => {
    const store = predictedStore(fakeWall());
    let calls = 0;
    registerReckoner("test.temperature", "test", {
      deps: [],
      window: { spanUt: 25, maxSamples: 16, minSamples: 4 },
      reckon(point) {
        calls++;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 5); // only 120, 130, 140 fall inside a 25s span
    store.beginFrame();
    const reading = store.sampleReading<number>("test.temperature");

    expect(calls).toBe(0);
    expect(reading.reckoning).toBe("none");
  });

  it("runs the model once the floor is met", () => {
    const store = predictedStore(fakeWall());
    let calls = 0;
    registerReckoner("test.temperature", "test", {
      deps: [],
      window: { spanUt: 25, maxSamples: 16, minSamples: 3 },
      reckon(point) {
        calls++;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 5);
    store.beginFrame();

    expect(store.sampleReading<number>("test.temperature").reckoning).toBe(
      "available",
    );
    expect(calls).toBeGreaterThan(0);
  });

  it("reaches a widget as an ordinary decline, with no new branch to write", () => {
    /*
     * On a topic the CONTRACT declares reckonable, a refusal is renderable
     * rather than a silence, and the automatic ones have to arrive in the shape
     * every hand-written decline already uses. `vessel.flight` is such a topic,
     * so registering a windowed model here is what proves the reason travels.
     */
    const store = predictedStore(fakeWall());
    registerReckoner("vessel.flight", "test", {
      deps: [],
      window: { spanUt: 60, maxSamples: 8, minSamples: 5 },
      reckon() {
        return { declined: { reason: "model-inapplicable" } };
      },
    });

    store.ingest("vessel.flight", {
      validAt: 100,
      payload: {} as never,
      meta: makeMeta({ validAt: 100, deliveredAt: 100 }),
      epoch: 0,
    });
    store.beginFrame();

    expect(store.sampleReading("vessel.flight")).toMatchObject({
      reckoning: "none",
      declined: { reason: "insufficient-history" },
    });
  });

  it("says when a break is what shortened the window, and when nothing did", () => {
    /*
     * "The window holds two samples" and "it holds two because the other four
     * are on the far side of a blackout" send an operator to different places:
     * one waits for more data, the other knows there was an outage. Only the
     * store can tell them apart, so the sentence it writes has to.
     */
    const store = predictedStore(fakeWall());
    registerReckoner("vessel.flight", "test", {
      deps: [],
      window: { spanUt: 1000, maxSamples: 16, minSamples: 6 },
      reckon() {
        return { declined: { reason: "model-inapplicable" } };
      },
    });

    const flight = (validAt: number, overrides = {}) => ({
      validAt,
      payload: {} as never,
      meta: makeMeta({ validAt, deliveredAt: validAt, ...overrides }),
      epoch: 0,
    });
    for (const validAt of [100, 110, 120, 130]) {
      store.ingest("vessel.flight", flight(validAt));
    }
    store.beginFrame();
    expect(store.sampleReading("vessel.flight")).toMatchObject({
      declined: {
        reason: "insufficient-history",
        note: expect.not.stringContaining("break in the record"),
      },
    });

    store.ingest("vessel.flight", flight(400, { gapSinceUt: 130 }));
    store.beginFrame();
    expect(store.sampleReading("vessel.flight")).toMatchObject({
      declined: {
        reason: "insufficient-history",
        note: expect.stringContaining("break in the record"),
      },
    });
  });
});

describe("a window stops at a break in the record", () => {
  it("truncates at a producer-declared gap and keeps the sample that names it", () => {
    /*
     * `Meta.gapSinceUt` is a POSITIVE claim: data existed between that UT and
     * this sample's own, and it is gone. Samples either side of it are not the
     * same regime, and a model handed both would take a trend through an outage
     * it has no readings for.
     */
    const store = predictedStore(fakeWall());
    let seen: readonly TimelinePoint<number>[] = [];
    registerReckoner("test.temperature", "test", {
      deps: [],
      window: { spanUt: 1000, maxSamples: 16 },
      reckon(point, _resolved, frame) {
        seen = frame.history;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 3); // 100, 110, 120
    store.ingest(
      "test.temperature",
      numberPoint(400, 200, { gapSinceUt: 120 }),
    );
    store.ingest("test.temperature", numberPoint(410, 201));
    store.beginFrame();
    store.sampleReading<number>("test.temperature");

    expect(seen.map((p) => p.validAt)).toEqual([400, 410]);
  });

  it("truncates at a tombstone, which is the value confirmed gone and back", () => {
    const store = predictedStore(fakeWall());
    let seen: readonly TimelinePoint<number>[] = [];
    registerReckoner("test.temperature", "test", {
      deps: [],
      window: { spanUt: 1000, maxSamples: 16 },
      reckon(point, _resolved, frame) {
        seen = frame.history;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 3); // 100, 110, 120
    store.ingest("test.temperature", numberPoint(130, null));
    store.ingest("test.temperature", numberPoint(140, 300));
    store.ingest("test.temperature", numberPoint(150, 301));
    store.beginFrame();
    store.sampleReading<number>("test.temperature");

    expect(seen.map((p) => p.validAt)).toEqual([140, 150]);
  });

  it("re-applies the floor to what survives, so the gap needs no rule of its own", () => {
    /*
     * Six samples are in the span and four of them are on the far side of a
     * break. Counting the span would say the model has plenty; counting what
     * survives the truncation says it has two. The second is the honest number,
     * and the sparse-reject that already exists is what says so.
     */
    const store = predictedStore(fakeWall());
    let calls = 0;
    registerReckoner("test.temperature", "test", {
      deps: [],
      window: { spanUt: 1000, maxSamples: 16, minSamples: 4 },
      reckon(point) {
        calls++;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 4); // 100, 110, 120, 130
    store.ingest(
      "test.temperature",
      numberPoint(400, 200, { gapSinceUt: 130 }),
    );
    store.ingest("test.temperature", numberPoint(410, 201));
    store.beginFrame();

    expect(calls).toBe(0);
    expect(store.sampleReading<number>("test.temperature").reckoning).toBe(
      "none",
    );
  });
});

describe("a dependency resolves to one point unless it opts in", () => {
  it("hold-last, because a change-gated stream stops carrying an unchanged value", () => {
    /*
     * `test.contact` last changed long before the window and nothing is
     * missing: its value now IS that value. A dep that demanded its own recent
     * samples would refuse to model anything whose input is a slow-moving
     * constant, which is most of them.
     */
    const store = predictedStore(fakeWall());
    let seen: TimelinePoint<TestContact> | undefined;
    registerReckoner("test.temperature", "test", {
      deps: ["test.contact"],
      reckon(point, [contact]) {
        seen = contact;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    store.ingest("test.contact", {
      validAt: 10,
      payload: { relativePosition: 5, name: "Mun Station" },
      meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
      epoch: 0,
    });
    ingestRun(store, 100, 3);
    store.beginFrame();
    store.sampleReading<number>("test.temperature");

    expect(Array.isArray(seen)).toBe(false);
    expect(seen).toMatchObject({ validAt: 10 });
  });

  it("resolves to an array of its own history once it declares a window", () => {
    const store = predictedStore(fakeWall());
    let seen: readonly TimelinePoint<TestContact>[] = [];
    registerReckoner("test.temperature", "test", {
      deps: ["test.contact"],
      depWindows: { "test.contact": { spanUt: 25, maxSamples: 16 } },
      reckon(point, [contacts]) {
        seen = contacts;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    for (const validAt of [70, 80, 90, 100]) {
      store.ingest("test.contact", {
        validAt,
        payload: { relativePosition: validAt, name: "Mun Station" },
        meta: makeMeta({ validAt, deliveredAt: validAt }),
        epoch: 0,
      });
    }
    ingestRun(store, 100, 3);
    store.beginFrame();
    store.sampleReading<number>("test.temperature");

    expect(Array.isArray(seen)).toBe(true);
    expect(seen.map((p) => p.validAt)).toEqual([80, 90, 100]);
  });

  it("declines an opted-in dep that has never produced a point", () => {
    /*
     * Same answer as an un-windowed dep that resolved to nothing: a declared
     * input the frame did not carry is a decline the store builds, and the
     * model is never asked a question it cannot answer.
     */
    const store = predictedStore(fakeWall());
    let calls = 0;
    registerReckoner("test.temperature", "test", {
      deps: ["test.contact"],
      depWindows: { "test.contact": { spanUt: 25, maxSamples: 16 } },
      reckon(point) {
        calls++;
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => point.payload ?? 0,
        };
      },
    });

    ingestRun(store, 100, 3);
    store.beginFrame();

    expect(calls).toBe(0);
    expect(store.sampleReading<number>("test.temperature").reckoning).toBe(
      "none",
    );
  });
});
