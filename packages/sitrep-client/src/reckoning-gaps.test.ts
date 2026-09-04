import { Quality, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReckonerFor } from "./reading";
import { observedAt } from "./reading";
import { clearReckoners, registerReckoner } from "./reckoners";
import {
  makeMeta,
  observedPayload,
  type WireOf,
  wrapWire,
} from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import type { VesselOrbitPayload } from "./vessel-state";
import { vesselStateChannel } from "./vessel-state";
import { ViewClock } from "./view-clock";

/**
 * The gaps between what `Reading`'s doc promises and what the store does.
 *
 * Each blocks every reckoner that could ever be written, so they sit in one
 * file rather than scattered across the suites that own the mechanisms they
 * break. `reading.ts` argues for three separate API decisions (no horizon
 * field, no failure return on `reckoned`, one `basis` per reading) on premises
 * this file shows are false, and `vessel.state` already ships the failure the
 * whole type exists to prevent.
 *
 * Every case here reads in PREDICTED mode. That is not incidental: in
 * confirmed mode the view clock clamps to the newest delivered sample, so
 * there is no gap between the observation and the frame and nothing to reckon
 * across. Reckoning is a question only where `viewUt` runs ahead of the last
 * thing that arrived, which is exactly what predicted mode is for.
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
  return { clock, store: new TimelineStore(clock) };
}

const CIRCULAR_ORBIT: WireOf<VesselOrbitPayload> = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12, // Kerbin's GM
  /*
   * What the stock producer always fills (`AnalyticHorizon()`), reach AND
   * shape. Required on the wire, so a fixture without it records a producer
   * that dropped a required field rather than a neutral scene, and
   * `deriveVesselStateReckoning` now refuses to propagate one: an absent
   * horizon is nobody's permission, which is `canPropagate`'s whole argument.
   */
  horizon: { kind: 1, trajectoryKind: 1 },
};

function orbitPoint(validAt: number): TimelinePoint<VesselOrbitPayload> {
  return {
    validAt,
    payload: wrapWire<VesselOrbitPayload>("VesselOrbit", CIRCULAR_ORBIT),
    meta: makeMeta({
      validAt,
      deliveredAt: validAt,
      quality: Quality.OnRails,
      source: "vessel:abc-123",
    }),
    epoch: 0,
  };
}

function numberPoint(validAt: number, payload: number): TimelinePoint<number> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

beforeEach(clearReckoners);

describe("a derived reading must not claim the frame's own view time as its observation", () => {
  it("vessel.state twenty minutes into a blackout reports the age of the ORBIT observation, not zero", () => {
    // `deriveVesselState` calls `trySolve(elements, viewUt)` with no staleness
    // gate, so `vessel.state.position` is already forward-modelled. The point
    // it comes back on is stamped `validAt: token.viewUt` and
    // `staleness: Fresh` (`derivedMeta`), so a widget asking how old this is
    // gets 0 however long the craft has been dark. An age of zero beside a
    // position carried twenty minutes is the sharpest form of the failure this
    // type exists to prevent.
    const wall = fakeWall();
    const { store } = predictedStore(wall);
    store.registerDerivedChannel(vesselStateChannel);

    store.ingest("vessel.orbit", orbitPoint(100));
    wall.advanceBy(1200);
    store.setTransportConnected(false);
    store.beginFrame();

    const viewUt = store.currentFrame().viewUt;
    expect(viewUt).toBe(1300);

    const reading = store.sampleReading<unknown>("vessel.state");
    expect(reading.state === "stale" || reading.state === "reckonable").toBe(
      true,
    );
    // The age, as the subtraction it now is: twenty minutes since the ORBIT was
    // observed, not zero because the derived channel was recomputed this frame.
    expect(
      value("ut", viewUt).minus(observedAt(reading) as Value<"ut">),
    ).toEqual(value("s", 1200));
  });

  it("does not serve a forward-modelled derived value on the `stale` arm", () => {
    // `Reading`'s doc on the stale arm: "The last REAL observation. Never a
    // modelled value." Under OnRails `vessel.state.position` IS
    // `kepler.solve(elements, viewUt)`, so serving it as `stale` makes the type
    // say the opposite of what it carries. A model that exists is what the
    // `reckonable` arm is for.
    const wall = fakeWall();
    const { store } = predictedStore(wall);
    store.registerDerivedChannel(vesselStateChannel);

    store.ingest("vessel.orbit", orbitPoint(100));
    wall.advanceBy(1200);
    store.setTransportConnected(false);
    store.beginFrame();

    expect(store.sampleReading<unknown>("vessel.state").state).toBe(
      "reckonable",
    );
  });
});

describe("a reckoner can see the UT it is reckoning for", () => {
  it("is handed the frame's view time, so it can honour a horizon", () => {
    // `reading.ts` justifies having no horizon field with "once the provider's
    // horizon is exceeded it stops offering a model". A reckoner cannot decide
    // that from what it is given: the point and the grade say when the
    // observation was made, never how far it is being asked to carry it.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    const seen: number[] = [];
    const reckoner: ReckonerFor<number> = (point, _grade, viewUt) => {
      seen.push(viewUt);
      return {
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => observedPayload(point),
      };
    };
    registerReckoner("temperature", "test", reckoner);

    store.ingest("temperature", numberPoint(100, 5));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();
    store.sampleReading<number>("temperature");

    expect(seen).toEqual([store.currentFrame().viewUt]);
  });

  it("produces a reckoning FOR the frame's view time, not the observation's", () => {
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    registerReckoner<number>("temperature", "test", (point) => ({
      modelled: [{ path: "", basis: "rate-integration" }],
      reckon: (at: number) => observedPayload(point) + (at - point.validAt),
    }));

    store.ingest("temperature", numberPoint(100, 5));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<number>("temperature");
    expect(reading.state).toBe("reckonable");
    if (reading.state !== "reckonable") return;
    const reckoning = reading.reckoned;
    expect(reckoning.atUt).toEqual(value("ut", 160));
    expect(reckoning.value).toBe(65);
  });
});

describe("a reckonable arm withdraws when its model stops being offered", () => {
  it("is re-derived on later frames, so a horizon can expire", () => {
    // The identity cache reuses a reading while its point, status and epoch are
    // unchanged. A blackout is exactly that for as long as it lasts, so a model
    // whose horizon expires two minutes in would go on being offered forever,
    // and `reading-identity.test.ts` pins that behaviour today.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    const HORIZON_SECONDS = 120;
    registerReckoner<number>("temperature", "test", (point, _grade, viewUt) => {
      if (viewUt - point.validAt > HORIZON_SECONDS) return undefined;
      return {
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => observedPayload(point),
      };
    });

    store.ingest("temperature", numberPoint(100, 5));
    wall.advanceBy(10);
    store.setTransportConnected(false);
    store.beginFrame();
    expect(store.sampleReading<number>("temperature").state).toBe("reckonable");

    // Nothing arrives; only time passes. Past the horizon the model withdraws
    // and the topic presents as stale from that frame on.
    wall.advanceBy(600);
    store.beginFrame();
    expect(store.sampleReading<number>("temperature").state).toBe("stale");
  });

  it("keeps a STALE reading's identity across frames in which nothing arrived", () => {
    // The guard on the fix above: unfreezing has to be narrowed to the arm
    // whose inputs include the view time, or every widget reading telemetry
    // re-renders at frame cadence forever, which is what the identity cache
    // was built to stop.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    store.ingest("temperature", numberPoint(100, 5));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();
    const first = store.sampleReading<number>("temperature");
    expect(first.state).toBe("stale");

    for (let i = 0; i < 10; i++) {
      wall.advanceBy(1);
      store.beginFrame();
    }
    expect(store.sampleReading<number>("temperature")).toBe(first);
  });
});

describe("a reckoning says which fields it actually modelled", () => {
  it("declines the whole-topic read when the model only covers one field", () => {
    // `vessel.target` flattens to 47 field paths across four reckoning
    // classes. A reckoner that dead-reckons `relativePosition` and copies the
    // rest must not stamp `basis: "linear-dead-reckoning"` on `name`, `kind`,
    // `partId`, `vesselId` and all of `meta` as well: that is a modelled label
    // over a stale observation, the failure the type exists to prevent,
    // committed by the mechanism meant to prevent it. A model that does not
    // cover the payload root cannot answer for the payload.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    type Target = { relativePosition: number; name: string };
    registerReckoner<Target>("vessel.target", "test", (point) => ({
      // Covers ONE field, never the root: the model has nothing to say about
      // the whole payload a topic-level read asks for.
      modelled: [{ path: "relativePosition", basis: "linear-dead-reckoning" }],
      reckon: () => ({ ...observedPayload(point), relativePosition: 42 }),
    }));

    store.ingest("vessel.target", {
      validAt: 100,
      payload: { relativePosition: 1, name: "Mun Station" },
      meta: makeMeta({ validAt: 100, deliveredAt: 100 }),
      epoch: 0,
    });
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    expect(store.sampleReading<Target>("vessel.target").state).toBe("stale");
  });
});

describe("a reckoning advances with the clock, not only with the post", () => {
  it("re-reckons on a frame in which nothing arrived", () => {
    // Every other case in this file calls beginFrame() by hand, so none of them
    // exercises the one scenario the machinery exists for: nothing arriving at
    // all. `TelemetryProvider` drives beginFrame from `client.subscribeStore`,
    // i.e. from INGEST, while `useViewUt` advances off requestAnimationFrame.
    // So during a total loss of contact the age a widget renders keeps climbing
    // while the modelled value beside it is the one computed at second zero:
    // "stale for twenty minutes" next to a projection for second one.
    //
    // The store cannot fix that alone, but it must not be the thing standing in
    // the way: a frame minted with no ingest has to produce a reckoning for
    // THAT frame's view time.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    registerReckoner<number>("temperature", "test", (point) => ({
      modelled: [{ path: "", basis: "rate-integration" }],
      reckon: (at: number) => observedPayload(point) + (at - point.validAt),
    }));

    store.ingest("temperature", numberPoint(100, 0));
    wall.advanceBy(10);
    store.setTransportConnected(false);
    store.beginFrame();

    const first = store.sampleReading<number>("temperature");
    if (first.state !== "reckonable") throw new Error("expected reckonable");
    expect(first.reckoned.value).toBe(10);

    // Ten more seconds of silence. Nothing ingests; only the clock moves.
    wall.advanceBy(10);
    store.beginFrame();

    const second = store.sampleReading<number>("temperature");
    if (second.state !== "reckonable") throw new Error("expected reckonable");
    expect(second.reckoned.value).toBe(20);
    expect(second.reckoned.atUt).toEqual(value("ut", 120));
  });
});

describe("a reckoning is computed once per arm, not once per read", () => {
  it("gives one identity however many times the field is read", () => {
    // A call site wanting both the number and its provenance touches this
    // twice, once for `.value` and once for `.basis`. One frame's answer must be
    // ONE object: two identities is the trap already fixed in `sampleReading`
    // and in the processor evaluator. A plain field gives this for free, which
    // is one of the reasons it is a plain field.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    registerReckoner<number>("temperature", "test", (point) => ({
      modelled: [{ path: "", basis: "rate-integration" }],
      reckon: (at: number) => observedPayload(point) + (at - point.validAt),
    }));

    store.ingest("temperature", numberPoint(100, 5));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<number>("temperature");
    if (reading.state !== "reckonable") throw new Error("expected reckonable");
    expect(reading.reckoned).toBe(reading.reckoned);
  });

  it("runs the model once per frame, however many times the field is read", () => {
    // For class A a second run is a second Kepler solve. Eager does not mean
    // repeated: the model runs when the arm is built and the field is then just
    // a field.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    let runs = 0;
    registerReckoner<number>("temperature", "test", (point) => ({
      modelled: [{ path: "", basis: "rate-integration" }],
      reckon: () => {
        runs += 1;
        return observedPayload(point);
      },
    }));

    store.ingest("temperature", numberPoint(100, 5));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<number>("temperature");
    if (reading.state !== "reckonable") throw new Error("expected reckonable");
    expect(runs).toBe(1);
    void reading.reckoned;
    void reading.reckoned;
    void reading.reckoned;
    expect(runs).toBe(1);
  });

  it("recomputes once the view time moves, so an answer cannot outlive its moment", () => {
    // The arm is rebuilt whenever the frame's view time moves, so the reckoning
    // is fresh per frame by construction. An answer that survived a frame would
    // be the freeze bug this file already pins, one layer in.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    registerReckoner<number>("temperature", "test", (point) => ({
      modelled: [{ path: "", basis: "rate-integration" }],
      reckon: (at: number) => observedPayload(point) + (at - point.validAt),
    }));

    store.ingest("temperature", numberPoint(100, 0));
    wall.advanceBy(10);
    store.setTransportConnected(false);
    store.beginFrame();
    const first = store.sampleReading<number>("temperature");
    if (first.state !== "reckonable") throw new Error("expected reckonable");
    expect(first.reckoned.value).toBe(10);

    wall.advanceBy(10);
    store.beginFrame();
    const second = store.sampleReading<number>("temperature");
    if (second.state !== "reckonable") throw new Error("expected reckonable");
    expect(second.reckoned).not.toBe(first.reckoned);
    expect(second.reckoned.value).toBe(20);
  });

  it("survives a copy, which is the point of it not being a getter", () => {
    // A getter here was lost by a spread, and lost SILENTLY: the spread
    // evaluated it and froze that frame's answer as a permanent plain value. A
    // field has no such failure mode, and this is what says the hazard is gone
    // rather than merely avoided.
    const wall = fakeWall();
    const { store } = predictedStore(wall);

    registerReckoner<number>("temperature", "test", (point) => ({
      modelled: [{ path: "", basis: "rate-integration" }],
      reckon: (at: number) => observedPayload(point) + (at - point.validAt),
    }));

    store.ingest("temperature", numberPoint(100, 5));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<number>("temperature");
    if (reading.state !== "reckonable") throw new Error("expected reckonable");
    const copied = { ...reading };
    expect(copied.reckoned).toBe(reading.reckoned);
    expect(copied.reckoned.value).toBe(65);
  });
});
