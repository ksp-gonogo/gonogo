import {
  type TopicPayload,
  type UncertaintyBand,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { clearReckoners, registerReckoner } from "./reckoners";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * A payload field reached as a plain property off the topic reading, and the
 * one thing about it that is not mechanical: where its BAND comes from.
 *
 * `vessel.flight.altitudeAsl` is the case the whole design turns on. A field
 * property built by delegating to a subtopic read is answered by whichever
 * reckoner owns whatever that name resolves to, and a reckoner claiming the
 * payload root offers no `bandAt` at all. The altitude band #64 added and issue
 * 255 fixed would come back `undefined` with nothing to notice: a reading that
 * still says `available`, still carries a modelled number, and quietly draws no
 * interval around it.
 *
 * So the field property is PROJECTED out of the topic reading's own model
 * instead, and these cases are what says so. A delegation is wrong for any
 * topic whose model bands one field of several, whatever the name resolves to.
 */

type Flight = TopicPayload<"vessel.flight">;

const OBSERVED_ALTITUDE = 34_000;
const OBSERVED_SPEED = 1_450;

function flightPayload(): Flight {
  return {
    latitude: value("°", 0),
    longitude: value("°", 0),
    altitudeAsl: value("m", OBSERVED_ALTITUDE),
    altitudeTerrain: value("m", OBSERVED_ALTITUDE),
    verticalSpeed: value("m/s", -120),
    surfaceSpeed: value("m/s", OBSERVED_SPEED),
    orbitalSpeed: value("m/s", OBSERVED_SPEED),
    gForce: value("g", 1),
    dynamicPressureKPa: value("kPa", 12),
    mach: value("1", 4.2),
    atmDensity: value("kg/m³", 0.02),
  } as Flight;
}

/** The band the model would defend its modelled altitude with. */
function altitudeBand(at: number): UncertaintyBand<"m"> {
  const carried = at - 10;
  const modelled = OBSERVED_ALTITUDE - 120 * carried;
  return {
    value: value("m", modelled),
    lo: value("m", modelled - 40 * carried),
    hi: value("m", modelled + 90 * carried),
    kind: "sigma1",
  };
}

/**
 * The shape of the real descent branch: it MOVES `altitudeAsl` and bands it at
 * that path, and copies every sibling verbatim. `orbitalSpeed` is here as the
 * sibling, because a field the model does not move must not come back wearing
 * the model's basis.
 */
function registerAltitudeOnlyModel(): void {
  registerReckoner("vessel.flight", "test", {
    deps: [],
    reckon: (point) => ({
      /*
       * The root FIRST and the moved field after it, which is what
       * `movedFields` builds for the real descent branch. The root is what a
       * whole-topic read needs to reach `available` at all; the second entry is
       * the one that says which path actually moved.
       */
      modelled: [
        { path: "", basis: "kepler-propagation" },
        { path: "altitudeAsl", basis: "rate-integration" },
      ],
      bandAt: (at: number) => ({ altitudeAsl: altitudeBand(at) }),
      reckon: (at: number) => ({
        altitudeAsl: altitudeBand(at).value,
        orbitalSpeed: point.payload?.orbitalSpeed,
      }),
    }),
  });
}

/** A store frozen at `viewUt`, with one `vessel.flight` observation at UT 10. */
function storeWithFlight(viewUt: number): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  clock.scrubTo(viewUt);
  const store = new TimelineStore(clock);
  store.beginFrame();
  store.ingest("vessel.flight", {
    validAt: 10,
    payload: flightPayload(),
    meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
    epoch: 0,
  });
  store.beginFrame();
  return store;
}

afterEach(() => clearReckoners());

describe("a field property carries the band its topic's model produced", () => {
  it("answers with the band the model keyed at that path", () => {
    registerAltitudeOnlyModel();
    const reading = storeWithFlight(40).sampleReading<Flight>("vessel.flight");

    const altitude = reading.altitudeAsl;
    expect(altitude.reckoning.status).toBe("available");
    if (altitude.reckoning.status !== "available") return;
    const band = altitude.reckoning.band;
    expect(band).toBeDefined();
    // 30 s carried at 120 m/s down: 30.4 km, with 1.2 km below and 2.7 above.
    expect(band?.value.magnitude).toBeCloseTo(30_400);
    expect(band?.lo.magnitude).toBeCloseTo(29_200);
    expect(band?.hi.magnitude).toBeCloseTo(33_100);
    expect(band?.kind).toBe("sigma1");
  });

  it("carries the modelled value and the basis of the entry covering the path", () => {
    registerAltitudeOnlyModel();
    const reading = storeWithFlight(40).sampleReading<Flight>("vessel.flight");

    const altitude = reading.altitudeAsl;
    if (altitude.reckoning.status !== "available")
      throw new Error("expected a model on the altitude");
    expect(altitude.reckoning.modelled.magnitude).toBeCloseTo(30_400);
    expect(altitude.reckoning.basis).toBe("rate-integration");
    // The OBSERVATION, never the modelled figure, exactly as on the topic.
    expect(altitude.value?.magnitude).toBe(OBSERVED_ALTITUDE);
  });

  /*
   * The MOST SPECIFIC entry wins, and this is the case that says so. Both the
   * root and `altitudeAsl` cover the altitude, and taking the root's basis
   * would label a rate-integrated descent as a conic. The sibling the model
   * only copies takes the root's basis, which is the inheritance the store's
   * own field read has always done.
   */
  it("takes the most specific covering entry, not the first one that covers", () => {
    registerAltitudeOnlyModel();
    const reading = storeWithFlight(40).sampleReading<Flight>("vessel.flight");

    expect(reading.reckoning.status).toBe("available");
    const speed = reading.orbitalSpeed;
    if (speed.reckoning.status !== "available")
      throw new Error("expected the root claim to reach the sibling");
    expect(speed.reckoning.basis).toBe("kepler-propagation");
    expect(speed.reckoning.band).toBeUndefined();
    expect(speed.value?.magnitude).toBe(OBSERVED_SPEED);
  });

  /*
   * A model claiming no root does not answer a whole-topic read at all, and so
   * cannot answer a field one either. It is the same rule `readingFrom` applies
   * to the topic, applied through: a projection of nothing is nothing, and
   * inventing a field-level model the topic itself declined to offer would be
   * the fabrication this whole type exists to stop.
   */
  it("reckons nothing at all for a model that claims no root", () => {
    registerReckoner("vessel.flight", "test", {
      deps: [],
      reckon: () => ({
        modelled: [{ path: "altitudeAsl", basis: "rate-integration" }],
        bandAt: (at: number) => ({ altitudeAsl: altitudeBand(at) }),
        reckon: (at: number) => ({ altitudeAsl: altitudeBand(at).value }),
      }),
    });
    const reading = storeWithFlight(40).sampleReading<Flight>("vessel.flight");

    expect(reading.reckoning.status).toBe("none");
    expect(reading.altitudeAsl.reckoning.status).toBe("none");
  });

  /*
   * The delegating implementation, spelled out. A root-claiming reckoner is
   * the shape `TimelineStore.derivedReckoner` builds, `{ modelled: [{ path:
   * "", basis }], reckon }` with no `bandAt`, so the reading comes back
   * `available` with no band anywhere on it.
   */
  it("loses the band to a root-claiming reckoner, which is what delegating would reach", () => {
    registerReckoner("vessel.flight", "test", {
      deps: [],
      reckon: () => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => flightPayload(),
      }),
    });
    const reading = storeWithFlight(40).sampleReading<Flight>("vessel.flight");

    if (reading.reckoning.status !== "available")
      throw new Error("expected the derived-shaped model to answer");
    expect(reading.reckoning.bands).toBeUndefined();
    expect(
      reading.altitudeAsl.reckoning.status === "available" &&
        reading.altitudeAsl.reckoning.band,
    ).toBeUndefined();
  });

  /*
   * A root claim DOES reach every field, for the basis. Coverage inherits down
   * because a basis is a property of the model and is true of every path it
   * moves; a band does not, which the case above is the other half of.
   */
  it("inherits a root claim's basis without inheriting the root's band", () => {
    registerReckoner("vessel.flight", "test", {
      deps: [],
      reckon: () => ({
        modelled: [{ path: "", basis: "kepler-propagation" }],
        bandAt: () => ({ "": altitudeBand(40) }),
        reckon: () => flightPayload(),
      }),
    });
    const reading = storeWithFlight(40).sampleReading<Flight>("vessel.flight");

    const altitude = reading.altitudeAsl;
    if (altitude.reckoning.status !== "available")
      throw new Error("expected the root claim to reach the field");
    expect(altitude.reckoning.basis).toBe("kepler-propagation");
    expect(altitude.reckoning.band).toBeUndefined();
  });
});

describe("a field property's currency is its topic's", () => {
  it("answers pending before anything has arrived, rather than throwing", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    clock.scrubTo(40);
    const store = new TimelineStore(clock);
    store.beginFrame();

    const reading = store.sampleReading<Flight>("vessel.flight");
    expect(reading.state).toBe("pending");
    expect(reading.altitudeAsl.state).toBe("pending");
    expect(reading.altitudeAsl.value).toBeUndefined();
    expect(reading.altitudeAsl.reckoning.status).toBe("none");
  });

  it("goes stale with its topic, at the same grade and the same asOfUt", () => {
    registerAltitudeOnlyModel();
    const store = storeWithFlight(40);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<Flight>("vessel.flight");
    if (reading.state !== "stale") throw new Error("expected a stale topic");
    expect(reading.altitudeAsl.state).toBe("stale");
    expect(reading.altitudeAsl.grade).toBe(reading.grade);
    expect(reading.altitudeAsl.asOfUt?.magnitude).toBe(10);
  });

  it("is built once and kept, so two reads of one field are one projection", () => {
    registerAltitudeOnlyModel();
    const reading = storeWithFlight(40).sampleReading<Flight>("vessel.flight");

    expect(reading.altitudeAsl).toBe(reading.altitudeAsl);
    expect(reading.altitudeAsl).not.toBe(reading.orbitalSpeed);
  });
});
