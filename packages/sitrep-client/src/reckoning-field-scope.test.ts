import { type ReckonerDefinition, value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearReckoners,
  getReckoner,
  getReckonerConflicts,
  registerReckoner,
} from "./reckoners";
import { makeMeta, observedPayload } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * A model is per TOPIC and its expression is per FIELD, and those are two
 * different granularities on purpose.
 *
 * The model has to be per topic because physics needs siblings: Kepler wants
 * eight elements at once, dead reckoning wants a position AND a velocity, rate
 * integration wants an amount, a capacity and a rate. `VesselOrbit` carries all
 * eight of Kepler's inputs including `mu`, whose doc says why in terms
 * ("self-sufficient propagation, no separate body lookup required"), so the
 * wire already delivers what a model needs atomically.
 *
 * The expression has to be per field because a payload is not one reckoning
 * class. `vessel.target` flattens to forty-seven paths: relative geometry that
 * propagates, identity fields only a command changes, two absolute UTs, and
 * metadata. A widget reading the relative position should get a model; a widget
 * reading the vessel's NAME should get a stale observation; and both should
 * happen in one frame off one model.
 */

interface Target {
  relativePosition: { x: number };
  name: string;
}

const OBSERVED: Target = { relativePosition: { x: 1000 }, name: "Mun Station" };

function targetPoint(validAt: number): TimelinePoint<Target> {
  return {
    validAt,
    payload: OBSERVED,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

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

/** Dead-reckons the relative position only; every other field is a copy. */
function registerPositionOnlyModel() {
  registerReckoner<Target>("vessel.target", "test", {
    deps: [],
    reckon: (point, _deps, { viewUt }) => ({
      modelled: [{ path: "relativePosition", basis: "linear-dead-reckoning" }],
      reckon: () => ({
        ...observedPayload(point),
        relativePosition: { x: 1000 + 10 * (viewUt - point.validAt) },
      }),
    }),
  });
}

beforeEach(clearReckoners);

describe("a per-topic model, expressed per field", () => {
  it("gives the modelled field a reckoning and an unmodelled sibling a stale reading, in one frame", () => {
    const wall = fakeWall();
    const store = predictedStore(wall);
    registerPositionOnlyModel();

    store.ingest("vessel.target", targetPoint(100));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const position = store.sampleReading<{ x: number }>(
      "vessel.target.relativePosition",
    );
    expect(position.reckoning).toBe("available");
    if (position.reckoning !== "available") return;
    const reckoning = position.reckoned;
    expect(reckoning.value).toEqual({ x: 1600 });
    expect(reckoning.atUt).toEqual(value("ut", 160));
    expect(reckoning.basis).toBe("linear-dead-reckoning");

    // Same frame, same model, same topic. Nothing dead-reckons a name, so the
    // sibling is offered no model at all: it is the reckoning axis that says
    // so, both fields being equally stale.
    const name = store.sampleReading<string>("vessel.target.name");
    expect(name.reckoning).toBe("none");
    expect(name.state).toBe("stale");
  });

  it("still declines the whole-topic read, because the model does not cover the payload", () => {
    // The guard on the above: a model that reaches one field must not become a
    // licence to stamp its basis on the record it happens to be part of.
    const wall = fakeWall();
    const store = predictedStore(wall);
    registerPositionOnlyModel();

    store.ingest("vessel.target", targetPoint(100));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    expect(store.sampleReading<Target>("vessel.target").reckoning).toBe("none");
  });

  it("carries the OBSERVED field value beside the reckoning, not the modelled one", () => {
    // The field read narrows the payload, so it would be easy for the arm's
    // `value` to come back already advanced. It must not: `value` is the last
    // real observation on every arm that has one, and the model is a pull.
    const wall = fakeWall();
    const store = predictedStore(wall);
    registerPositionOnlyModel();

    store.ingest("vessel.target", targetPoint(100));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const position = store.sampleReading<{ x: number }>(
      "vessel.target.relativePosition",
    );
    if (position.reckoning !== "available")
      throw new Error("expected a reckoning on offer");
    if (position.state !== "stale") throw new Error("expected stale");
    expect(position.value).toEqual({ x: 1000 });
    expect(position.asOfUt).toEqual(value("ut", 100));
  });

  it("covers a nested path under a covered parent", () => {
    // Coverage is a path PREFIX, not an exact match: a model claiming
    // `relativePosition` has answered for `relativePosition.x` too, which is
    // the read a scalar readout actually makes.
    const wall = fakeWall();
    const store = predictedStore(wall);
    registerPositionOnlyModel();

    store.ingest("vessel.target", targetPoint(100));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const x = store.sampleReading<number>("vessel.target.relativePosition.x");
    expect(x.reckoning).toBe("available");
    if (x.reckoning !== "available") return;
    expect(x.reckoned.value).toBe(1600);
  });

  it("does not treat a covered path as a prefix of an unrelated sibling", () => {
    // `relativePositionError` starts with `relativePosition` as a STRING and is
    // a different field. Prefix matching has to be segment-wise or a model
    // silently answers for fields nobody claimed.
    const wall = fakeWall();
    const store = predictedStore(wall);
    registerReckoner<{
      relativePosition: number;
      relativePositionError: number;
    }>("vessel.dock", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [
          { path: "relativePosition", basis: "linear-dead-reckoning" },
        ],
        reckon: () => observedPayload(point),
      }),
    });

    store.ingest("vessel.dock", {
      validAt: 100,
      payload: { relativePosition: 5, relativePositionError: 1 },
      meta: makeMeta({ validAt: 100, deliveredAt: 100 }),
      epoch: 0,
    });
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    expect(
      store.sampleReading<number>("vessel.dock.relativePositionError")
        .reckoning,
    ).toBe("none");
  });
});

describe("a topic two owners both model is served with neither", () => {
  const declines: ReckonerDefinition<Target> = {
    deps: [],
    reckon: () => ({
      declined: { reason: "model-inapplicable" },
    }),
  };

  beforeEach(clearReckoners);

  it("answers with no model, so the reading is honestly stale", () => {
    // Last-write-wins would have picked by module import order, which is a
    // fact about the bundler and not a judgement about the physics. A reading
    // with no model says "nothing trustworthy can be said", which is true; one
    // carrying whichever model loaded second is a confident picture assembled
    // by accident, and a wrong reckoner is worse than none.
    registerReckoner<Target>("vessel.target", "two-body-model", {
      deps: [],
      reckon: () => ({
        modelled: [{ path: "", basis: "linear-dead-reckoning" }],
        reckon: () => OBSERVED,
      }),
    });
    registerReckoner<Target>("vessel.target", "n-body-model", {
      deps: [],
      reckon: () => ({
        modelled: [{ path: "", basis: "kepler-propagation" }],
        reckon: () => OBSERVED,
      }),
    });

    const wall = fakeWall();
    const store = predictedStore(wall);
    store.ingest("vessel.target", targetPoint(100));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<Target>("vessel.target");
    expect(reading.reckoning).toBe("none");
    expect(reading.state).toBe("stale");
    expect(getReckonerConflicts()).toEqual([
      { topic: "vessel.target", owners: ["n-body-model", "two-body-model"] },
    ]);
  });

  it("reports no conflict when one owner re-registers", () => {
    // A module re-evaluating under HMR, or a test re-importing after
    // resetModules, is a benign single-owner case and must not look like two
    // Uplinks disagreeing.
    registerReckoner<Target>("vessel.target", "two-body-model", declines);
    registerReckoner<Target>("vessel.target", "two-body-model", declines);

    expect(getReckonerConflicts()).toEqual([]);
    expect(getReckoner("vessel.target")?.definition).toBe(declines);
  });
});

describe("every path to a reckoning shares the one cache", () => {
  beforeEach(clearReckoners);

  it("memoises a FIELD-scoped reckoning, not just a whole-topic one", () => {
    // `fieldScopedReckoner` and `derivedReckoner` build `TopicModel`s, and
    // `readingFrom` is the single place that wraps one into a `Reckoning`. So
    // both inherit the cache rather than needing their own, and this asserts
    // that rather than assuming it: a partial fix here would be
    // indistinguishable from a complete one at every call site.
    const wall = fakeWall();
    const store = predictedStore(wall);

    let runs = 0;
    registerReckoner<Target>("vessel.target", "test", {
      deps: [],
      reckon: (point, _deps, { viewUt }) => ({
        modelled: [
          { path: "relativePosition", basis: "linear-dead-reckoning" },
        ],
        reckon: () => {
          runs += 1;
          return {
            ...observedPayload(point),
            relativePosition: { x: 1000 + 10 * (viewUt - point.validAt) },
          };
        },
      }),
    });

    store.ingest("vessel.target", targetPoint(100));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const position = store.sampleReading<{ x: number }>(
      "vessel.target.relativePosition",
    );
    if (position.reckoning !== "available")
      throw new Error("expected a reckoning on offer");
    expect(position.reckoned).toBe(position.reckoned);
    expect(runs).toBe(1);
  });
});
