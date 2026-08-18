import { Quality, wrapTypePayload } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReckonerFor } from "./reading";
import { readingAge } from "./reading";
import { clearReckoners, registerReckoner } from "./reckoners";
import { makeMeta } from "./stub-transport";
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
 * field, no failure return on `reckon()`, one `basis` per reading) on premises
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

const CIRCULAR_ORBIT: Record<string, unknown> = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12, // Kerbin's GM
};

function orbitPoint(validAt: number): TimelinePoint<VesselOrbitPayload> {
  return {
    validAt,
    payload: wrapTypePayload(
      "VesselOrbit",
      CIRCULAR_ORBIT,
    ) as VesselOrbitPayload,
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
    expect(readingAge(reading, viewUt)).toBe(1200);
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
        reckon: () => point.payload,
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
      reckon: (at: number) => point.payload + (at - point.validAt),
    }));

    store.ingest("temperature", numberPoint(100, 5));
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<number>("temperature");
    expect(reading.state).toBe("reckonable");
    if (reading.state !== "reckonable") return;
    const reckoning = reading.reckon();
    expect(reckoning.atUt).toBe(160);
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
        reckon: () => point.payload,
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
      reckon: () => ({ ...point.payload, relativePosition: 42 }),
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
