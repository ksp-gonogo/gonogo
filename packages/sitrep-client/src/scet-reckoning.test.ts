import { value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { TestTarget } from "./reckoner-test-topics";
import {
  clearReckoners,
  registerCoreReckoners,
  registerReckoner,
} from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * A reading's reckoning is for the craft's present (SCET), while its sampled
 * observation, its staleness and its bar stay on the received edge.
 */

/** One-way light time, seconds. */
const OWLT = 240;
const UT_NOW = 10_000;
const TOPIC = "test.temperature";

function point(validAt: number, payload: number): TimelinePoint<number> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: UT_NOW }),
    epoch: 0,
  };
}

/** A model that climbs one unit per UT second from its observation, so its answer names the instant it was asked for. */
function registerRamp() {
  const asked: number[] = [];
  registerReckoner(TOPIC, "test", {
    deps: [],
    reckon(observed, _resolved, frame) {
      asked.push(frame.reckonUt);
      return {
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at) => (observed.payload ?? 0) + (at - observed.validAt),
      };
    },
  });
  return asked;
}

function startStore(delaySeconds = OWLT) {
  let wall = 0;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => delaySeconds,
  });
  const store = new TimelineStore(clock);
  store.ingest(TOPIC, point(UT_NOW - delaySeconds, 50));
  store.beginFrame();
  return { clock, store, advance: (by: number) => (wall += by) };
}

beforeEach(clearReckoners);

describe("the frame's SCET", () => {
  it("is the craft's present, a light-time past the received edge", () => {
    const { store } = startStore();
    const frame = store.currentFrame();
    expect(frame.viewUt).toBe(UT_NOW - OWLT);
    expect(frame.scetUt).toBe(UT_NOW);
  });

  it("is the received edge when the light-time is under a second", () => {
    const { store } = startStore(0.4);
    const frame = store.currentFrame();
    expect(frame.scetUt).toBe(frame.viewUt);
  });

  it("is the scrub target while the view is scrubbed", () => {
    const { clock, store } = startStore();
    clock.scrubTo(9_000);
    const frame = store.beginFrame();
    expect(frame.viewUt).toBe(9_000);
    expect(frame.scetUt).toBe(9_000);
  });

  it("never steps back within an epoch when the estimate re-anchors lower", () => {
    const { clock, store, advance } = startStore();
    advance(10);
    expect(store.beginFrame().scetUt).toBe(UT_NOW + 10);
    clock.observeSample(UT_NOW - OWLT + 1, UT_NOW + 5);
    expect(store.beginFrame().scetUt).toBe(UT_NOW + 10);
  });

  it("starts again after a rewind", () => {
    const { clock, store, advance } = startStore();
    advance(10);
    expect(store.beginFrame().scetUt).toBe(UT_NOW + 10);
    clock.observeSample(4_000 - OWLT, 4_000, 1);
    expect(store.beginFrame().scetUt).toBe(4_000);
  });
});

describe("a reading under signal delay", () => {
  it("reckons to SCET and keeps its observation at the received edge", () => {
    const asked = registerRamp();
    const { store } = startStore();
    const reading = store.sampleReading<number>(TOPIC);

    expect(reading.state).toBe("observed");
    if (reading.state !== "observed") return;
    expect(reading.value).toBe(50);
    expect(reading.atUt).toEqual(value("ut", UT_NOW - OWLT));
    expect(reading.reckoning.status).toBe("available");
    if (reading.reckoning.status !== "available") return;
    expect(reading.reckoning.atUt).toEqual(value("ut", UT_NOW));
    expect(reading.reckoning.value).toBe(50 + OWLT);
    expect(asked).toEqual([UT_NOW]);
  });

  it("keeps its staleness grade on the received edge", () => {
    registerRamp();
    const { store } = startStore();
    expect(store.sampleStatus(TOPIC)).toBe("live");
  });

  it("reckons to the scrub target on a scrubbed view", () => {
    registerRamp();
    const { clock, store } = startStore();
    store.ingest(TOPIC, point(8_900, 20));
    clock.scrubTo(9_000);
    store.beginFrame();
    const reading = store.sampleReading<number>(TOPIC);
    if (reading.reckoning.status !== "available") {
      throw new Error("expected a reckoning");
    }
    expect(reading.reckoning.atUt).toEqual(value("ut", 9_000));
  });

  it("gives a new reading when only SCET moved", () => {
    registerRamp();
    const { store, advance } = startStore();
    const first = store.sampleReading<number>(TOPIC);
    advance(5);
    store.beginFrame();
    const second = store.sampleReading<number>(TOPIC);
    expect(second).not.toBe(first);
    if (second.reckoning.status !== "available") {
      throw new Error("expected a reckoning");
    }
    expect(second.reckoning.atUt).toEqual(value("ut", UT_NOW + 5));
  });
});

describe("a field's reckoning", () => {
  it("names the instant its modelled value is for", () => {
    registerReckoner("test.target", "test", {
      deps: [],
      reckon(observed) {
        return {
          modelled: [{ path: "", basis: "rate-integration" }],
          reckon: () => observed.payload,
        };
      },
    });
    const { store } = startStore();
    store.ingest("test.target", {
      validAt: UT_NOW - OWLT,
      payload: { relativePosition: { x: 1 }, name: "a" },
      meta: makeMeta({ validAt: UT_NOW - OWLT, deliveredAt: UT_NOW }),
      epoch: 0,
    });
    store.beginFrame();
    const reading = store.sampleReading<TestTarget>("test.target");
    const field = reading.relativePosition.reckoning;
    if (field.status !== "available") throw new Error("expected a reckoning");
    expect(field.atUt).toEqual(value("ut", UT_NOW));
  });
});

describe("a model that integrates from the last observation", () => {
  function targetStore(delaySeconds: number) {
    clearReckoners();
    registerCoreReckoners();
    const clock = new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => delaySeconds,
    });
    const store = new TimelineStore(clock);
    const observedAt = UT_NOW - delaySeconds;
    store.ingest("vessel.target", {
      validAt: observedAt,
      payload: {
        relativePosition: { x: 100, y: 0, z: 0 },
        relativeVelocity: { x: 1, y: 0, z: 0 },
      },
      meta: makeMeta({ validAt: observedAt, deliveredAt: UT_NOW }),
      epoch: 0,
    });
    store.beginFrame();
    return store;
  }

  it("carries a live observation across the light-time to SCET", () => {
    const reading = targetStore(20).sampleReading<{
      relativePosition: { x: number };
    }>("vessel.target");
    expect(reading.state).toBe("observed");
    if (reading.reckoning.status !== "available") {
      throw new Error("expected a reckoning");
    }
    expect(reading.reckoning.value.relativePosition.x).toBeCloseTo(120);
  });

  it("declines on a live observation when there is no light-time to carry it across", () => {
    const reading = targetStore(0).sampleReading("vessel.target");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "model-inapplicable" },
    });
  });

  it("counts the light-time against its horizon", () => {
    const reading = targetStore(60).sampleReading("vessel.target");
    expect(reading.state).toBe("observed");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "beyond-horizon" },
    });
  });
});
