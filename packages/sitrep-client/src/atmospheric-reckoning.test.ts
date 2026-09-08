import { Quality, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { Reading } from "./reading";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * `vessel.flight.altitudeAsl` below the atmosphere interface, where the conic
 * withdraws.
 *
 * The conic's withdrawal at the interface is correct and is also why a reckoned
 * altitude was unavailable during exactly the descent that motivated reckoning
 * it. What replaces it integrates the OBSERVED rates over a declared window, so
 * every case here is either about the HANDOVER (which of the two models owns a
 * frame, and that it is never both or neither) or about a withdrawal the
 * integration makes on its own evidence.
 *
 * Nothing here fixes a sample interval. The fixtures deliberately ingest at
 * uneven spacings, and the one case that pins the arithmetic picks numbers a
 * fixed-interval assumption would get wrong: the stream is change-gated, so a
 * topic carries a point when its value changed and at no other time.
 *
 * Every case reads in PREDICTED mode with the transport DOWN, which is what puts
 * `viewUt` ahead of the newest sample and grades the reading stale. A rate
 * integration declines on a live reading by design (there is no gap to carry the
 * value across), and the last case here is the one that pins that.
 */

const KERBIN_INDEX = 1;
const KERBIN_RADIUS = 600_000;
const KERBIN_MU = 3.5316e12;
const ATMOSPHERE_DEPTH = 70_000;
/** Airless, so `atmosphereDepthOf` answers nothing for it. */
const MINMUS_INDEX = 2;
const MINMUS_RADIUS = 60_000;
const MINMUS_MU = 1.7658e9;

const SYSTEM = {
  bodies: [
    {
      name: "Kerbin",
      index: KERBIN_INDEX,
      parentIndex: 0,
      radius: KERBIN_RADIUS,
      orbit: null,
      atmosphere: { depth: ATMOSPHERE_DEPTH },
    },
    {
      name: "Minmus",
      index: MINMUS_INDEX,
      parentIndex: KERBIN_INDEX,
      radius: MINMUS_RADIUS,
      orbit: null,
    },
  ],
};

/**
 * A circular orbit whose radius sits ABOVE Kerbin's entry interface, so the
 * conic is admissible on every frame here.
 *
 * That is the point of choosing it: with both models able to answer, the only
 * thing deciding which one does is the selector, so a case that gets the
 * atmospheric basis got it because of the observed altitude and not because the
 * conic had quietly run out.
 */
function orbitOf(referenceBodyIndex: number, radius: number, mu = KERBIN_MU) {
  return {
    referenceBodyIndex,
    sma: value("m", radius),
    ecc: value("1", 0),
    inc: value("°", 0),
    lan: value("°", 0),
    argPe: value("°", 0),
    meanAnomalyAtEpoch: value("rad", 0),
    epoch: value("ut", 0),
    mu: value("m³/s²", mu),
    horizon: { kind: 1, trajectoryKind: 1 },
  };
}

/** One `vessel.flight` sample: only the fields either model reads. */
interface FlightSample {
  altitudeAsl: Value<"m">;
  verticalSpeed: Value<"m/s">;
  orbitalSpeed: Value<"m/s">;
  gForce: Value<"g">;
}

function flightPoint(
  validAt: number,
  altitudeAsl: number,
  verticalSpeed: number,
  gForce: number,
  meta: Partial<ReturnType<typeof makeMeta>> = {},
): TimelinePoint<FlightSample> {
  return {
    validAt,
    payload: {
      altitudeAsl: value("m", altitudeAsl),
      verticalSpeed: value("m/s", verticalSpeed),
      orbitalSpeed: value("m/s", 2200),
      gForce: value("g", gForce),
    },
    meta: makeMeta({
      validAt,
      deliveredAt: validAt,
      quality: Quality.OnRails,
      source: "vessel:descent",
      ...meta,
    }),
    epoch: 0,
  };
}

/**
 * A `vessel.flight` sample carrying only the named fields, for the cases about
 * an input that did not arrive.
 *
 * The wire's fields are all required on the generated type and a partial frame
 * is still what arrives, which is why the model checks each one it reads rather
 * than trusting the type.
 */
function partialFlightPoint(
  validAt: number,
  payload: Partial<FlightSample>,
): TimelinePoint<Partial<FlightSample>> {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt,
      quality: Quality.OnRails,
      source: "stub",
    }),
    epoch: 0,
  };
}

function point<T>(validAt: number, payload: T): TimelinePoint<T> {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt,
      quality: Quality.OnRails,
      source: "vessel:descent",
    }),
    epoch: 0,
  };
}

/**
 * A store whose view time is dialled directly, with the transport DOWN so every
 * reading is graded `disconnected` rather than waiting out a heartbeat margin.
 *
 * The wall clock is advanced to each sample's own instant BEFORE it is ingested,
 * which is not decoration: `ViewClock.observeSample` anchors the UT/wall fit at
 * `(now(), deliveredAt)`, so ingesting a run of samples without moving the wall
 * anchors UT 10 to wall 0 and every later `viewUt` reads ten seconds further
 * ahead than the dial says. A fixture whose samples all sit at UT 0 cannot feel
 * that, which is why the existing reckoner fixtures do not.
 */
function scene(
  bodyIndex = KERBIN_INDEX,
  orbitRadius = 700_000,
  mu = KERBIN_MU,
) {
  let wall = 0;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.setMode("predicted");
  const store = new TimelineStore(clock);
  store.setTransportConnected(false);
  store.ingest("system.bodies", point(0, SYSTEM));
  store.ingest("vessel.orbit", point(0, orbitOf(bodyIndex, orbitRadius, mu)));
  return {
    store,
    /** Ingest a descent run at the given (uneven) instants. */
    descend(
      samples: readonly {
        at: number;
        altitudeAsl: number;
        verticalSpeed: number;
        gForce?: number;
        gapSinceUt?: number;
        source?: string;
      }[],
    ) {
      for (const s of samples) {
        wall = s.at;
        store.ingest(
          "vessel.flight",
          flightPoint(s.at, s.altitudeAsl, s.verticalSpeed, s.gForce ?? 2, {
            ...(s.gapSinceUt === undefined ? {} : { gapSinceUt: s.gapSinceUt }),
            ...(s.source === undefined ? {} : { source: s.source }),
          }),
        );
      }
    },
    at(viewUt: number): Reading<FlightSample> {
      wall = viewUt;
      store.beginFrame();
      return store.sampleReading<FlightSample>("vessel.flight");
    },
  };
}

/**
 * A straight descent whose vertical speed falls by exactly 5 m/s per second,
 * sampled at 0, 1, 2 and 10 UT.
 *
 * The spacing is the assertion. Three samples bunched at the start and one eight
 * seconds later is what a change-gated stream produces when a value moves in
 * bursts, and a fit that divided the total change by the SAMPLE COUNT would read
 * the slope as -50/3 rather than -5. Perfectly linear so the least-squares slope
 * is exact and the expected altitude can be written down rather than
 * approximated.
 */
const UNEVEN_DESCENT = [
  { at: 0, altitudeAsl: 60_000, verticalSpeed: -200 },
  { at: 1, altitudeAsl: 59_798, verticalSpeed: -205 },
  { at: 2, altitudeAsl: 59_590, verticalSpeed: -210 },
  { at: 10, altitudeAsl: 57_600, verticalSpeed: -250 },
] as const;

/** The reckoned altitude, or `undefined` where the model withdrew. */
function reckonedAltitude(reading: Reading<FlightSample>): number | undefined {
  return reading.reckoning === "available"
    ? reading.reckoned.value.altitudeAsl.magnitude
    : undefined;
}

beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

describe("the handover between the conic and the air", () => {
  it("carries the altitude by its observed rates below the interface", () => {
    const s = scene();
    s.descend(UNEVEN_DESCENT);

    // Three seconds past the newest observation: 57600 + (-250)(3) +
    // 0.5(-5)(9). The fitted acceleration is -5 m/s², taken from the ELAPSED
    // time across the window, not from its sample count.
    const reading = s.at(13);

    expect(reading.reckoning).toBe("available");
    expect(reckonedAltitude(reading)).toBeCloseTo(56_827.5, 6);
    expect(
      reading.reckoning === "available" ? reading.reckoned.basis : undefined,
    ).toBe("rate-integration");
  });

  it("names the altitude as moved and leaves the orbital speed a verbatim copy", () => {
    /*
     * One reading carries one projection over every marked field of a topic, so
     * `orbitalSpeed` has to be PRESENT. What says it was not modelled is
     * `modelled`, and a consumer overlaying the projection on the observation
     * therefore sees the last measured speed rather than an invented one.
     */
    const s = scene();
    s.descend(UNEVEN_DESCENT);
    const reading = s.at(13);

    if (reading.reckoning !== "available") throw new Error("expected a model");
    expect(reading.reckoned.modelled).toEqual([
      { path: "", basis: "rate-integration" },
      { path: "altitudeAsl", basis: "rate-integration" },
    ]);
    expect(reading.reckoned.value.orbitalSpeed.magnitude).toBe(2200);
  });

  it("flips from the conic to the air at the atmosphere depth, and never to neither", () => {
    /*
     * The property the handover exists for: one comparison against one published
     * number, so there is no altitude band where both models decline and none
     * where both offer. The orbit is the same on both frames and is admissible
     * on both, so the basis changing is the SELECTOR changing and nothing else.
     */
    const above = scene();
    above.descend([
      { at: 0, altitudeAsl: ATMOSPHERE_DEPTH, verticalSpeed: -200 },
      { at: 1, altitudeAsl: ATMOSPHERE_DEPTH, verticalSpeed: -205 },
    ]);
    const below = scene();
    below.descend([
      { at: 0, altitudeAsl: ATMOSPHERE_DEPTH - 1, verticalSpeed: -200 },
      { at: 1, altitudeAsl: ATMOSPHERE_DEPTH - 1, verticalSpeed: -205 },
    ]);

    const readingAbove = above.at(3);
    const readingBelow = below.at(3);

    expect(
      readingAbove.reckoning === "available"
        ? readingAbove.reckoned.basis
        : "declined",
    ).toBe("kepler-propagation");
    expect(
      readingBelow.reckoning === "available"
        ? readingBelow.reckoned.basis
        : "declined",
    ).toBe("rate-integration");
  });

  it("claims nothing on an airless body, at the very altitude that is air on Kerbin", () => {
    /*
     * The selector is the published DEPTH and not the altitude, so five
     * kilometres up is deep inside Kerbin's atmosphere and is simply low orbit
     * over Minmus. `entryInterfaceRadius` falls back to the bare surface on an
     * airless body, so a selector keyed on that floor would hand a craft near
     * the Minmus flats to a model named for atmospheric drag; there is no
     * atmospheric regime without air.
     */
    const LOW = 5_000;
    const air = scene();
    air.descend([
      { at: 0, altitudeAsl: LOW, verticalSpeed: -200 },
      { at: 1, altitudeAsl: LOW - 202, verticalSpeed: -205 },
    ]);
    const vacuum = scene(MINMUS_INDEX, MINMUS_RADIUS + LOW, MINMUS_MU);
    vacuum.descend([
      { at: 0, altitudeAsl: LOW, verticalSpeed: -200 },
      { at: 1, altitudeAsl: LOW - 202, verticalSpeed: -205 },
    ]);

    const overAir = air.at(3);
    const overVacuum = vacuum.at(3);

    expect(
      overAir.reckoning === "available" ? overAir.reckoned.basis : "declined",
    ).toBe("rate-integration");
    expect(
      overVacuum.reckoning === "available"
        ? overVacuum.reckoned.basis
        : "declined",
    ).toBe("kepler-propagation");
  });
});

describe("what the descent withdraws on", () => {
  it("declines past the horizon rather than extrapolating confidently", () => {
    const s = scene();
    s.descend(UNEVEN_DESCENT);

    // gForce 2 on the newest sample, so the horizon is 15/2 = 7.5 seconds.
    const reading = s.at(20);

    expect(reading.reckoning).toBe("none");
    expect(reading).toMatchObject({
      declined: { reason: "beyond-horizon" },
    });
  });

  it("closes that horizon as the sensed deceleration rises", () => {
    /*
     * The load-bearing use of `gForce`: the same gap is honest in a steady
     * regime and is not at peak entry deceleration, and the wire publishes the
     * measure of which one the craft is in. Identical rates on both runs, so the
     * only difference is the sensed magnitude.
     */
    const steady = scene();
    steady.descend([
      { at: 0, altitudeAsl: 60_000, verticalSpeed: -200, gForce: 1 },
      { at: 2, altitudeAsl: 59_600, verticalSpeed: -210, gForce: 1 },
    ]);
    const violent = scene();
    violent.descend([
      { at: 0, altitudeAsl: 60_000, verticalSpeed: -200, gForce: 6 },
      { at: 2, altitudeAsl: 59_600, verticalSpeed: -210, gForce: 6 },
    ]);

    // Ten seconds past the observation: inside 15 s, outside 15/6 = 2.5 s.
    expect(steady.at(12).reckoning).toBe("available");
    expect(violent.at(12)).toMatchObject({
      reckoning: "none",
      declined: { reason: "beyond-horizon" },
    });
  });

  it("declines with the record's own reason when the window holds one sample", () => {
    /*
     * A slope taken from one point is not a slope. The floor is asserted by the
     * branch rather than declared as `window.minSamples`, because the store
     * settles that for the whole TOPIC and `vessel.flight`'s other model is a
     * conic that needs exactly one point.
     */
    const s = scene();
    s.descend([{ at: 0, altitudeAsl: 60_000, verticalSpeed: -200 }]);

    const reading = s.at(3);

    expect(reading.reckoning).toBe("none");
    expect(reading).toMatchObject({
      declined: {
        reason: "insufficient-history",
        note: expect.stringContaining("the window holds 1"),
      },
    });
  });

  it("does not draw a trend across a break in the record", () => {
    /*
     * The producer says data existed before this sample and is gone, so the
     * window truncates at it and the run before the blackout is not available to
     * take a rate from. Samples either side of an outage are not the same
     * regime, and the honest answer is the same one as having no history at all.
     */
    const s = scene();
    s.descend([
      { at: 0, altitudeAsl: 60_000, verticalSpeed: -200 },
      { at: 1, altitudeAsl: 59_798, verticalSpeed: -205 },
      { at: 2, altitudeAsl: 59_590, verticalSpeed: -210 },
      { at: 6, altitudeAsl: 58_000, verticalSpeed: -240, gapSinceUt: 3 },
    ]);

    expect(s.at(8)).toMatchObject({
      reckoning: "none",
      declined: { reason: "insufficient-history" },
    });
  });

  it("does not take a trend across a change of subject", () => {
    /*
     * The store truncates a window at a break in the RECORD and not at a change
     * of CRAFT, so the older samples here belong to another vessel on the same
     * topic. Two vessels' descent rates are not one craft's trend, and the step
     * between them would read as an enormous acceleration; the filter drops them
     * and what is left meets the same floor as any other short window.
     */
    const s = scene();
    s.descend([
      {
        at: 0,
        altitudeAsl: 30_000,
        verticalSpeed: -20,
        source: "vessel:other",
      },
      {
        at: 1,
        altitudeAsl: 29_980,
        verticalSpeed: -21,
        source: "vessel:other",
      },
      {
        at: 2,
        altitudeAsl: 29_959,
        verticalSpeed: -22,
        source: "vessel:other",
      },
      { at: 3, altitudeAsl: 60_000, verticalSpeed: -200 },
    ]);

    expect(s.at(5)).toMatchObject({
      reckoning: "none",
      declined: { reason: "insufficient-history" },
    });
  });

  it("declines a slope that gravity and the sensed deceleration cannot produce", () => {
    /*
     * The window's fit is a mean over the lookback and the envelope is the
     * independent instrument on it: whatever the aerodynamics did, the total
     * vertical acceleration cannot exceed local gravity plus the sensed
     * non-gravitational magnitude. A slope outside that is a window straddling a
     * change of regime, not a trend, and 1950 m/s² is neither an atmosphere nor
     * an engine.
     */
    const s = scene();
    s.descend([
      { at: 0, altitudeAsl: 60_000, verticalSpeed: -200, gForce: 1 },
      { at: 0.1, altitudeAsl: 59_980, verticalSpeed: -5, gForce: 1 },
    ]);

    const reading = s.at(2);

    expect(reading.reckoning).toBe("none");
    expect(reading).toMatchObject({
      declined: { note: expect.stringContaining("change of regime") },
    });
  });

  it("names the two same-payload inputs the way the contract spells them", () => {
    /*
     * `verticalSpeed` and `gForce` are DECLARED inputs of the rate-integration
     * mark, so the decline puts them in `ReckoningDecline.input`, which is the
     * field a widget renders. The rate first and the bound second: without the
     * rate there is nothing to integrate at all, and without the sensed
     * deceleration there is no horizon to stay inside.
     */
    const noRate = scene();
    noRate.store.ingest(
      "vessel.flight",
      partialFlightPoint(0, { altitudeAsl: value("m", 60_000) }),
    );
    noRate.store.ingest(
      "vessel.flight",
      partialFlightPoint(1, { altitudeAsl: value("m", 59_800) }),
    );
    expect(noRate.at(3)).toMatchObject({
      declined: { reason: "input-absent", input: "verticalSpeed" },
    });

    const noBound = scene();
    for (const at of [0, 1]) {
      noBound.store.ingest(
        "vessel.flight",
        partialFlightPoint(at, {
          altitudeAsl: value("m", 60_000 - at * 200),
          verticalSpeed: value("m/s", -200 - at * 5),
        }),
      );
    }
    expect(noBound.at(3)).toMatchObject({
      declined: { reason: "input-absent", input: "gForce" },
    });
  });

  it("adds nothing to a live reading, where the altitude was just measured", () => {
    /*
     * A rate integration starts FROM the last observation, so on a live reading
     * it would replace a measured altitude with arithmetic about the same
     * instant. The same posture `elapsedOrDecline` takes for the dead-reckoned
     * pair, and the opposite of the conic's, which is a CAUSE and true of a
     * value that arrived on time.
     */
    const s = scene();
    s.store.setTransportConnected(true);
    s.descend(UNEVEN_DESCENT);

    const reading = s.at(10);

    expect(reading.state).toBe("observed");
    expect(reading.reckoning).toBe("none");
    expect(reading).toMatchObject({
      declined: { note: expect.stringContaining("the observation is current") },
    });
  });
});
