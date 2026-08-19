import { Quality, Staleness, value } from "@ksp-gonogo/sitrep-sdk";
import {
  activateProcessor,
  clearProcessorRuntime,
  getProcessorValue,
  setActiveTimelineStore,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHIP_SYSTEMS, type ShipSystems } from "./processor";

/**
 * The live bug, closed: a Ship Systems summary knows how current the resource
 * levels it was derived from actually are.
 *
 * Every figure the summary produces (a level, a rate, a time-to-empty) is a
 * function of `vessel.resources`. The processor resolved that dep to
 * `point.payload`, the value channel alone, so it could not tell a current
 * level from one observed twenty minutes ago, and the widget presented a
 * last-contact projection as current with nothing in the render saying so.
 *
 * It now takes the READING and reports its own provenance. Not a nested
 * `Reading`: a summary reasoning across resources is not one Topic's currency.
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
function predictedStore(wall: { now: () => number }): TimelineStore {
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.setMode("predicted");
  return new TimelineStore(clock);
}

function resourcesPoint(validAt: number, water: number) {
  return {
    validAt,
    payload: {
      resources: {
        Water: { current: water, max: 100, active: true },
      },
    },
    meta: {
      source: "vessel:abc",
      validAt,
      seq: 0,
      deliveredAt: validAt,
      vantage: "ksc",
      quality: Quality.OnRails,
      active: true,
      staleness: Staleness.Fresh,
      timelineEpoch: 0,
    },
    epoch: 0,
  };
}

let deactivate: (() => void) | undefined;

beforeEach(() => {
  clearProcessorRuntime();
});

afterEach(() => {
  deactivate?.();
  deactivate = undefined;
  setActiveTimelineStore(undefined);
});

function read(store: TimelineStore): ShipSystems | undefined {
  return getProcessorValue(SHIP_SYSTEMS.id) as ShipSystems | undefined;
}

describe("a Ship Systems summary reports the currency of its levels", () => {
  it("says observed while the levels are current", () => {
    const wall = fakeWall();
    const store = predictedStore(wall);
    setActiveTimelineStore(store);
    deactivate = activateProcessor(SHIP_SYSTEMS.id);

    store.ingest("vessel.resources", resourcesPoint(100, 80));
    store.beginFrame();

    expect(read(store)?.levels.state).toBe("observed");
    // The instant, not a bare number: `asOfUt` carries `Value<"ut">` now, which is
    // what lets an age be a subtraction rather than a helper.
    expect(read(store)?.levels.asOfUt).toEqual(value("ut", 100));
    expect(read(store)?.levels.ageSec).toBe(0);
  });

  it("says STALE, and how old, once the levels stop arriving", () => {
    // The bug. Before this the summary was identical either way, so a
    // time-to-empty computed off twenty-minute-old levels rendered exactly like
    // one computed off a live reading.
    const wall = fakeWall();
    const store = predictedStore(wall);
    setActiveTimelineStore(store);
    deactivate = activateProcessor(SHIP_SYSTEMS.id);

    store.ingest("vessel.resources", resourcesPoint(100, 80));
    store.beginFrame();
    expect(read(store)?.levels.state).toBe("observed");

    wall.advanceBy(1200);
    store.setTransportConnected(false);
    store.beginFrame();

    const levels = read(store)?.levels;
    expect(levels?.state).toBe("stale");
    // The OBSERVATION's UT, not the frame's: the whole point is that these two
    // have come apart.
    expect(levels?.asOfUt).toEqual(value("ut", 100));
    expect(levels?.ageSec).toBe(1200);
  });

  it("still derives from the last observed levels rather than blanking", () => {
    // Reporting staleness must not mean throwing the numbers away: "80 units at
    // last contact, 20 minutes ago" is the useful statement, and the operator
    // specifically wants the last real value reachable.
    const wall = fakeWall();
    const store = predictedStore(wall);
    setActiveTimelineStore(store);
    deactivate = activateProcessor(SHIP_SYSTEMS.id);

    store.ingest("vessel.resources", resourcesPoint(100, 80));
    store.beginFrame();
    wall.advanceBy(1200);
    store.setTransportConnected(false);
    store.beginFrame();

    const summary = read(store)?.summary;
    expect(summary).toBeDefined();
    expect(read(store)?.levels.state).toBe("stale");
  });

  it("has no age before anything has arrived", () => {
    // `pending` is a real arm and not a zero: a summary with no levels yet must
    // not report an age of zero seconds, which reads as "just now".
    const wall = fakeWall();
    const store = predictedStore(wall);
    setActiveTimelineStore(store);
    deactivate = activateProcessor(SHIP_SYSTEMS.id);

    store.beginFrame();

    const levels = read(store)?.levels;
    expect(levels?.state).toBe("pending");
    expect(levels?.asOfUt).toBeUndefined();
    expect(levels?.ageSec).toBeUndefined();
  });
});
