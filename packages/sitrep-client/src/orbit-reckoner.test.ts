import { type ConicBodiesInput, Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { TopicReading } from "./reading";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * `vessel.orbit`'s own model, and the one thing it exists to say.
 *
 * The OnRails/Loaded split keys on `meta.quality`, which sits on the POINT. A
 * `Reading` carries no meta and no consumer in this tree reads one, so a widget
 * solving apsides from `vessel.orbit` has no other way of knowing the elements
 * are osculating: it would draw a number where the tree deliberately draws
 * nothing.
 *
 * A reckoner IS handed points, so this is where that decision can live. What a
 * consumer then branches on is the reckoning, which it can already see.
 */

const PLANET_MU = 3.5316e12;
const SMA = 2_000_000;
const PERIOD = 2 * Math.PI * Math.sqrt(SMA ** 3 / PLANET_MU);

function orbitPayload() {
  return {
    referenceBodyIndex: 1,
    sma: value("m", SMA),
    ecc: value("1", 0),
    inc: value("°", 0),
    lan: value("°", 0),
    argPe: value("°", 0),
    meanAnomalyAtEpoch: value("rad", 0),
    epoch: value("ut", 0),
    mu: value("m³/s²", PLANET_MU),
    horizon: { kind: 1, trajectoryKind: 1 },
  };
}

function point<Payload>(validAt: number, payload: Payload, quality: Quality) {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt + LIGHT_TIME_SECONDS,
      source: "vessel:probe",
      quality,
    }),
    epoch: 0,
  } as TimelinePoint<Payload>;
}

/** The one-way light-time the orbit sample is delivered across. */
const LIGHT_TIME_SECONDS = 10;

/**
 * A store carrying one orbit sample at the given quality, read at the SCET
 * `at` is given. The wall clock stands for the craft's UT, so the sample lands
 * a light-time after it was stamped.
 * `roster` is the `system.bodies` payload, and `null` leaves the roster out.
 */
/** An airless body well inside the orbit, so a coast round it is in vacuum. */
const AIRLESS: ConicBodiesInput = {
  bodies: [{ index: 1, radius: value("m", 1_000_000) }],
};

function propulsion(thrustKn: number) {
  return {
    totalMass: value("t", 10),
    dryMass: value("t", 4),
    currentThrust: value("kN", thrustKn),
    availableThrust: value("kN", thrustKn),
    thrustStartedUt: thrustKn > 0 ? value("ut", 0) : null,
    lastThrustEndUt: null,
  };
}

/** One command dispatched at `dispatchedAt` that reaches the craft a light-time later. */
function inFlight(dispatchedAt: number) {
  return {
    pending: [
      {
        id: "1",
        clientRequestId: "",
        command: "vessel.control.throttle",
        label: "",
        topic: "",
        vantage: "",
        dispatchedAt: value("ut", dispatchedAt),
        oneWaySeconds: value("s", LIGHT_TIME_SECONDS),
      },
    ],
  };
}

function scene(
  quality: Quality,
  roster: ConicBodiesInput | null = { bodies: [] },
  loaded: {
    thrustKn?: number;
    pending?: ReturnType<typeof inFlight>;
  } = {},
) {
  let wall = LIGHT_TIME_SECONDS;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => LIGHT_TIME_SECONDS,
  });
  const store = new TimelineStore(clock);
  store.setTransportConnected(false);
  if (roster !== null) {
    store.ingest("system.bodies", point(0, roster, Quality.OnRails));
  }
  store.ingest("vessel.orbit", point(0, orbitPayload(), quality));
  if (loaded.thrustKn !== undefined) {
    store.ingest(
      "vessel.propulsion",
      point(0, propulsion(loaded.thrustKn), quality),
    );
  }
  if (loaded.pending !== undefined) {
    store.ingest("system.uplink.pending", point(0, loaded.pending, quality));
  }
  return {
    at(scetUt: number): TopicReading<ReturnType<typeof orbitPayload>> {
      wall = scetUt;
      store.beginFrame();
      return store.sampleReading("vessel.orbit");
    },
  };
}

beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

describe("the vessel.orbit reckoner", () => {
  it("advances the phase along the conic while the craft is on rails", () => {
    const reading = scene(Quality.OnRails).at(PERIOD / 4);

    expect(reading.reckoning.status).toBe("available");
    if (reading.reckoning.status !== "available")
      throw new Error("unreachable");
    // A quarter period on a circular orbit is a quarter turn: the mean anomaly the model reports is π/2, and its epoch is the instant asked about.
    expect(reading.reckoning.value.meanAnomalyAtEpoch?.magnitude).toBeCloseTo(
      Math.PI / 2,
      6,
    );
    expect(reading.reckoning.value.epoch?.magnitude).toBeCloseTo(PERIOD / 4, 6);
  });

  /**
   * The safety rule, and the reason this reckoner exists at all. Under thrust
   * the elements are osculating, so the conic declines and a consumer has
   * something to branch on. Without it the same consumer sees a perfectly
   * ordinary orbit payload and no signal that deriving from it is wrong.
   */
  it("WITHDRAWS while the craft is loaded and under thrust, so a consumer can refuse to derive", () => {
    const reading = scene(Quality.Loaded, AIRLESS, { thrustKn: 60 }).at(
      PERIOD / 4,
    );

    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "under-physics", input: "@vessel.propulsion" },
    });
  });

  it("withdraws a loaded craft whose engines nothing has reported", () => {
    const reading = scene(Quality.Loaded, AIRLESS).at(PERIOD / 4);

    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "under-physics", input: "@vessel.propulsion" },
    });
  });

  it("carries a loaded craft coasting in vacuum along its orbit, as it does one on rails", () => {
    const reading = scene(Quality.Loaded, AIRLESS, { thrustKn: 0 }).at(
      PERIOD / 4,
    );

    expect(reading.reckoning.status).toBe("available");
    if (reading.reckoning.status !== "available")
      throw new Error("unreachable");
    expect(reading.reckoning.basis).toBe("kepler-propagation");
    expect(reading.reckoning.value.meanAnomalyAtEpoch?.magnitude).toBeCloseTo(
      Math.PI / 2,
      6,
    );
  });

  it("withdraws a loaded coast across a command that reaches the craft in the gap", () => {
    const sent = 5;
    const coast = scene(Quality.Loaded, AIRLESS, {
      thrustKn: 0,
      pending: inFlight(sent),
    });

    expect(coast.at(sent + LIGHT_TIME_SECONDS - 1).reckoning.status).toBe(
      "available",
    );
    expect(coast.at(PERIOD / 4).reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "under-physics", input: "@system.uplink.pending" },
    });
  });

  /**
   * The roster only places the atmosphere floor, so with none there is no floor
   * to have crossed, and every orbit read in the frames before the body channel
   * lands must still be carried.
   */
  it("still advances the conic while the body roster has not arrived", () => {
    const reading = scene(Quality.OnRails, null).at(PERIOD / 4);

    expect(reading.reckoning.status).toBe("available");
    if (reading.reckoning.status !== "available")
      throw new Error("unreachable");
    expect(reading.reckoning.value.meanAnomalyAtEpoch?.magnitude).toBeCloseTo(
      Math.PI / 2,
      6,
    );
  });

  /** The roster still bounds the conic once it is there, even held stale. */
  it("withdraws below the atmosphere interface the roster places", () => {
    const reading = scene(Quality.OnRails, {
      bodies: [{ index: 1, radius: 1_900_000, atmosphere: { depth: 200_000 } }],
    }).at(PERIOD / 4);

    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "beyond-horizon", input: "@system.bodies" },
    });
  });

  /** The observation itself is untouched either way: only the model withdraws. */
  it("still hands back the observed elements when it withdraws", () => {
    const reading = scene(Quality.Loaded).at(PERIOD / 4);

    /*
     * Stale rather than observed because the scene's transport is down and the
     * read is a quarter period after the sample; what matters here is that the
     * elements are still there to read.
     */
    expect(reading.state).toBe("held");
    /*
     * Narrowed rather than optional-chained: now that `vessel.orbit` carries a
     * mark, `value` is only on the value-bearing arms, which is the whole point
     * of the union and is exactly the branch a consumer has to write.
     */
    if (reading.state !== "held") throw new Error("unreachable");
    expect(reading.value.ecc?.magnitude).toBe(0);
  });
});
