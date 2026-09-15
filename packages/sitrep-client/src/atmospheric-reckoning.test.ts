import {
  propagateVesselOrbit,
  Quality,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { TopicReading } from "./reading";
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

/**
 * A reentry ellipse: apoapsis 200 km, periapsis 50 km BELOW sea level.
 *
 * The circular orbit above holds the conic still, which is what isolates the
 * selector in most of this file. The crossing band needs the opposite: elements
 * that actually fall, so the radius the conic SOLVES for at the view time is
 * lower than the one it was at when the last packet arrived. Sub-surface
 * periapsis because that is what the wire carries during a descent, KSP
 * recomputing the drag-free conic the craft is instantaneously on.
 */
const REENTRY = (() => {
  const peri = KERBIN_RADIUS - 50_000;
  const apo = KERBIN_RADIUS + 200_000;
  return {
    sma: (peri + apo) / 2,
    ecc: (apo - peri) / (apo + peri),
  };
})();

/**
 * The mean anomaly that puts the craft at `radius` on the DESCENDING branch.
 *
 * `r = a(1 - e cos E)` has two solutions and only one of them is coming down;
 * taking `2π - E` is what picks it, and getting it wrong produces a fixture
 * that climbs out of the air instead of into it.
 */
function descendingMeanAnomaly(radius: number): number {
  const eccentric =
    2 * Math.PI - Math.acos((1 - radius / REENTRY.sma) / REENTRY.ecc);
  return eccentric - REENTRY.ecc * Math.sin(eccentric);
}

function reentryOrbitAt(radius: number, epochUt: number) {
  return {
    referenceBodyIndex: KERBIN_INDEX,
    sma: value("m", REENTRY.sma),
    ecc: value("1", REENTRY.ecc),
    inc: value("°", 0),
    lan: value("°", 0),
    argPe: value("°", 0),
    meanAnomalyAtEpoch: value("rad", descendingMeanAnomaly(radius)),
    epoch: value("ut", epochUt),
    mu: value("m³/s²", KERBIN_MU),
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
  orbit: ReturnType<typeof orbitOf> = orbitOf(bodyIndex, orbitRadius, mu),
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
  store.ingest("vessel.orbit", point(0, orbit));
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
    at(viewUt: number): TopicReading<FlightSample> {
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

/**
 * A craft two kilometres above Kerbin's interface at 400 m/s down, still in
 * near-free fall so the sensed magnitude is negligible and the horizon is wide
 * open.
 *
 * The anchor is UT 20 and the speeds are it walked backwards at a constant
 * -7.9 m/s², so the least-squares slope IS that acceleration and the envelope
 * (gravity plus 0.03 g, times the slack) comfortably holds it. What decides the
 * case is the selector and nothing else.
 */
const CROSSING_BAND = [
  { at: 9, altitudeAsl: 75_922.0, verticalSpeed: -313.1, gForce: 0.03 },
  { at: 13, altitudeAsl: 74_606.45, verticalSpeed: -344.7, gForce: 0.03 },
  { at: 17, altitudeAsl: 73_164.45, verticalSpeed: -376.3, gForce: 0.03 },
  { at: 20, altitudeAsl: 72_000, verticalSpeed: -400, gForce: 0.03 },
] as const;

/** The reckoned altitude, or `undefined` where the model withdrew. */
function reckonedAltitude(
  reading: TopicReading<FlightSample>,
): number | undefined {
  return reading.reckoning.status === "available"
    ? reading.reckoning.value.altitudeAsl.magnitude
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

    expect(reading.reckoning.status).toBe("available");
    expect(reckonedAltitude(reading)).toBeCloseTo(56_827.5, 6);
    expect(
      reading.reckoning.status === "available"
        ? reading.reckoning.basis
        : undefined,
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

    if (reading.reckoning.status !== "available")
      throw new Error("expected a model");
    expect(reading.reckoning.modelled).toEqual([
      { path: "", basis: "rate-integration" },
      { path: "altitudeAsl", basis: "rate-integration" },
    ]);
    expect(reading.reckoning.value.orbitalSpeed.magnitude).toBe(2200);
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
      readingAbove.reckoning.status === "available"
        ? readingAbove.reckoning.basis
        : "declined",
    ).toBe("kepler-propagation");
    expect(
      readingBelow.reckoning.status === "available"
        ? readingBelow.reckoning.basis
        : "declined",
    ).toBe("rate-integration");
  });

  it("hands the crossing band to the air, where the conic's own solution is already inside it", () => {
    /*
     * THE CROSSING BAND: observed two kilometres ABOVE the interface, and
     * falling fast enough that the conic's own solution at the view time is
     * already below it. The two halves of the handover used to judge different
     * instants here, the selector the observation and the conic's floor the
     * view time, so the frame went to the conic and the conic withdrew, and the
     * air was never asked. That band is `|verticalSpeed| x gap` wide and every
     * reentry crosses it.
     */
    const ANCHOR = 20;
    const VIEW = ANCHOR + 6;
    const orbit = reentryOrbitAt(KERBIN_RADIUS + 72_000, ANCHOR);
    /*
     * The premise, pinned rather than assumed: without this the ellipse could
     * drift until the observation itself is below the interface and the case
     * quietly becomes a duplicate of the plain below-the-air one above.
     */
    const solved = propagateVesselOrbit(orbit, VIEW);
    if (solved == null) throw new Error("the reentry ellipse must solve");
    expect(Math.hypot(...solved.position) - KERBIN_RADIUS).toBeLessThan(
      ATMOSPHERE_DEPTH,
    );

    const s = scene(KERBIN_INDEX, 700_000, KERBIN_MU, orbit);
    s.descend(CROSSING_BAND);

    const reading = s.at(VIEW);

    expect(reading.reckoning.status).toBe("available");
    expect(
      reading.reckoning.status === "available"
        ? reading.reckoning.basis
        : undefined,
    ).toBe("rate-integration");
    // 72000 + (-400)(6) + 0.5(-7.9)(36), the observed rates carried six seconds.
    expect(reckonedAltitude(reading)).toBeCloseTo(69_457.8, 6);
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
      overAir.reckoning.status === "available"
        ? overAir.reckoning.basis
        : "declined",
    ).toBe("rate-integration");
    expect(
      overVacuum.reckoning.status === "available"
        ? overVacuum.reckoning.basis
        : "declined",
    ).toBe("kepler-propagation");
  });

  it("does not read an airless body's surface floor as air, even when the conic is under it", () => {
    /*
     * The far end of the span is tested against `entryInterfaceRadius`, which
     * falls back to the BARE SURFACE where there is no published depth. So the
     * selector asks the depth first, and this is what pins that ordering: a conic
     * solving below the Minmus surface must still be the conic's own refusal and
     * not a handover to a model named for atmospheric drag.
     *
     * The elements are deliberately degenerate, a circle a kilometre below the
     * surface, because what is under test is the selector and not the orbit: it
     * puts the solved radius under the floor on every frame without any descent
     * arithmetic to get wrong.
     */
    const s = scene(MINMUS_INDEX, MINMUS_RADIUS - 1_000, MINMUS_MU);
    s.descend([
      { at: 0, altitudeAsl: 5_000, verticalSpeed: -200 },
      { at: 1, altitudeAsl: 4_798, verticalSpeed: -205 },
    ]);

    const reading = s.at(3);

    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "beyond-horizon", input: "@system.bodies" },
    });
  });
});

describe("what the descent withdraws on", () => {
  it("declines past the horizon rather than extrapolating confidently", () => {
    const s = scene();
    s.descend(UNEVEN_DESCENT);

    // gForce 2 on the newest sample, so the horizon is 15/2 = 7.5 seconds.
    const reading = s.at(20);

    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
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
    expect(steady.at(12).reckoning.status).toBe("available");
    expect(violent.at(12).reckoning).toMatchObject({
      status: "declined",
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

    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
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

    expect(s.at(8).reckoning).toMatchObject({
      status: "declined",
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

    expect(s.at(5).reckoning).toMatchObject({
      status: "declined",
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

    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
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
    expect(noRate.at(3).reckoning).toMatchObject({
      status: "declined",
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
    expect(noBound.at(3).reckoning).toMatchObject({
      status: "declined",
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
    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { note: expect.stringContaining("the observation is current") },
    });
  });
});

/**
 * The same descent as a SERIES: what a chart can draw across the silence the
 * readings above describe one frame at a time.
 *
 * `vessel.flight`'s fields are `Value`s, so until `computeReckonedTail` learned
 * to carry a wrapped quantity the tail was empty on every frame of this
 * scenario and the only topic in the tree that could produce a dashed trace was
 * `vessel.state`, whose record holds bare magnitudes. The point read said "the
 * altitude is 56 827 m, carried by rate-integration" while a plot of the same
 * quantity stopped at the last packet, which is the asymmetry these cases pin.
 */
describe("the carried altitude as a plotted tail", () => {
  it("samples the field subtopic across the gap", () => {
    const s = scene();
    s.descend(UNEVEN_DESCENT);
    // Inside the 15/2 = 7.5 s horizon the sensed deceleration leaves open.
    s.at(16);

    const tail = s.store.sampleReckonedTail<Value<"m">>(
      "vessel.flight.altitudeAsl",
      0,
      16,
    );

    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((sample) => sample.basis === "rate-integration")).toBe(
      true,
    );
    // Every instant lands after the newest observation and no later than the
    // view time, which is the interval a tail is defined over.
    expect(tail.every((sample) => sample.atUt > 10 && sample.atUt <= 16)).toBe(
      true,
    );
  });

  it("carries the metre rather than handing the chart a bare number", () => {
    const s = scene();
    s.descend(UNEVEN_DESCENT);
    s.at(13);

    const tail = s.store.sampleReckonedTail<Value<"m">>(
      "vessel.flight.altitudeAsl",
      0,
      13,
    );
    const last = tail[tail.length - 1];

    expect(last.atUt).toBe(13);
    expect(last.value.unit).toBe("m");
    // The same arithmetic the point read is pinned against at this instant:
    // 57600 + (-250)(3) + 0.5(-5)(9).
    expect(last.value.magnitude).toBeCloseTo(56_827.5, 6);
  });
});

/**
 * A descent whose vertical speeds do NOT sit on one line, sampled unevenly
 * inside `DESCENT_WINDOW`'s eight-second lookback.
 *
 * Every instant is within eight seconds of the anchor, which
 * {@link UNEVEN_DESCENT} deliberately is not: its two oldest samples fall
 * outside the window and the fit there runs on the two that remain. A residual
 * needs a THIRD sample, so a fixture meant to produce one has to sit inside the
 * lookback, and that is the difference between the two.
 *
 * The scatter is chosen rather than sprinkled, and the choice is the whole
 * reason the arithmetic below can be written down. The residuals `[1, -2, 1, 0]`
 * are orthogonal to both a constant and to `t - tBar`, so the least-squares
 * slope is still exactly -5 m/s² and the fit's own error is the only thing that
 * changes: the altitudes are that slope integrated twice, so the carried number
 * is the same one the perfectly-linear case is pinned against and the band
 * beside it is the only difference between them.
 *
 * With `tBar = 5.5` the residual sum of squares is `1 + 4 + 1 = 6` over
 * `n - 2 = 2` degrees of freedom, and the time spread is
 * `2.5² + 1.5² + 0.5² + 4.5² = 29`, so the slope's standard error is
 * `sqrt(3 / 29)`.
 */
const SCATTERED_DESCENT = [
  { at: 3, altitudeAsl: 59_227.5, verticalSpeed: -214 },
  { at: 4, altitudeAsl: 59_010, verticalSpeed: -222 },
  { at: 5, altitudeAsl: 58_787.5, verticalSpeed: -224 },
  { at: 10, altitudeAsl: 57_600, verticalSpeed: -250 },
] as const;

/** The standard error of `SCATTERED_DESCENT`'s fitted acceleration, in m/s². */
const SCATTERED_SIGMA = Math.sqrt(3 / 29);

/**
 * The same four instants with the residuals taken back out, so every sample
 * sits exactly on the -5 m/s² line.
 *
 * The control for {@link SCATTERED_DESCENT}: same window, same sample count,
 * same fitted slope, and a residual sum of squares of zero. It isolates the one
 * thing the two differ on, which is whether the window holds any evidence about
 * how wrong the fit might be.
 */
const LINEAR_IN_WINDOW = SCATTERED_DESCENT.map((s, i) => ({
  ...s,
  verticalSpeed: s.verticalSpeed - [1, -2, 1, 0][i],
}));

/**
 * The same shape again at -5.2 m/s² instead of -5, which is the same fixture to
 * a reader and a different one to the hardware.
 *
 * {@link LINEAR_IN_WINDOW}'s speeds are whole metres per second on a line of
 * whole slope, so every quantity in the fit is exact in binary and the residual
 * sum of squares comes out as literally 0. Move the line a tenth and nothing
 * about the physics changes, but -5.2 and the speeds it produces are all
 * repeating fractions in base two, so the same perfect fit leaves a residual
 * sum of squares of about 8e-28: a rounding of the arithmetic rather than a
 * disagreement between the samples and the line.
 *
 * Which of those two a real descent lands on is decided by nothing the operator
 * can see. Of the 191 accelerations between -1.0 and -20.0 m/s² in tenths, 85
 * leave residue at these instants and 106 do not, and the generated handover
 * set's -7.4 m/s² frame is one of the 85: the interval it offered was
 * 1.2e-13 m wide and captioned with a one-sigma claim.
 */
const LINEAR_OFF_THE_BINARY_GRID = [
  { at: 3, altitudeAsl: 59_222.6, verticalSpeed: -213.6 },
  { at: 4, altitudeAsl: 59_006.4, verticalSpeed: -218.8 },
  { at: 5, altitudeAsl: 58_785, verticalSpeed: -224 },
  { at: 10, altitudeAsl: 57_600, verticalSpeed: -250 },
] as const;

/** The UT of a campaign a few years in, rather than of a fresh save. */
const CAMPAIGN_UT = 1_000_000;

/**
 * The same perfect line again, moved to a campaign's UT.
 *
 * The scale the residue is judged against has to bound every rounding that went
 * into a predicted value, and the largest of them is not in the speeds. `tBar`
 * is a mean of INSTANTS, so its own rounding is a fraction of an ulp of UT, and
 * the slope multiplies that up into the speeds it is compared against. These
 * three samples sit exactly on a -5 m/s² line and leave a residual RMS of
 * 6.7e-10 m/s: fifteen hundred times a rounding of their own 250 m/s speeds, and
 * a tenth of one rounding of the fit's working magnitude.
 *
 * So a threshold scaled by the speeds alone reads this as the window disagreeing
 * with the line and offers a 5.6e-10 m interval for it. The committed handover
 * set is the same shape at UT ~1000 against speeds of ~700, where the miss is a
 * factor of 13 to 45; here it is a factor of 1500. Three samples rather than
 * four because four of these instants average exactly in binary and leave no
 * residue for the guard to have an opinion about.
 */
const LINEAR_AT_CAMPAIGN_UT = [
  { at: CAMPAIGN_UT + 3, altitudeAsl: 59_227.5, verticalSpeed: -215 },
  { at: CAMPAIGN_UT + 4, altitudeAsl: 59_010, verticalSpeed: -220 },
  { at: CAMPAIGN_UT + 10, altitudeAsl: 57_600, verticalSpeed: -250 },
] as const;

/**
 * {@link SCATTERED_DESCENT}'s residuals divided by a thousand, so the window's
 * disagreement is faint and entirely real.
 *
 * The control in the other direction. Withholding on residue has to be a claim
 * about the ARITHMETIC's precision and not a floor under how small a genuine
 * error may be, and a threshold set by eye rather than by the machine's epsilon
 * would swallow this: the residual RMS here is 1.7e-3 m/s where the rounding of
 * a 250 m/s sample is 4e-13. The same orthogonal residuals, so the slope is
 * still exactly -5 and the carried altitude is unmoved.
 */
const FAINTLY_SCATTERED = SCATTERED_DESCENT.map((s, i) => ({
  ...s,
  verticalSpeed: s.verticalSpeed - [1, -2, 1, 0][i] + [1, -2, 1, 0][i] / 1000,
}));

/** The band the model offers about the altitude, or `undefined` where it offers none. */
function altitudeBand(reading: TopicReading<FlightSample>) {
  return reading.reckoning.status === "available"
    ? reading.reckoning.bands?.altitudeAsl
    : undefined;
}

describe("how well the descent fit knows the altitude it carried", () => {
  it("bands the altitude by the fit's own standard error, growing with the square of the carry", () => {
    const s = scene();
    s.descend(SCATTERED_DESCENT);

    const reading = s.at(13);
    const band = altitudeBand(reading);

    // Only the ACCELERATION is fitted: the anchor's altitude and descent rate
    // are measurements the wire carried once, with no residuals to take a sigma
    // from. So the half-width is `0.5 x sigma_a x dt²` and nothing else.
    const halfWidth = 0.5 * SCATTERED_SIGMA * 3 * 3;
    expect(band?.kind).toBe("sigma1");
    expect(band?.value.magnitude).toBeCloseTo(56_827.5, 6);
    expect(band?.lo.magnitude).toBeCloseTo(56_827.5 - halfWidth, 6);
    expect(band?.hi.magnitude).toBeCloseTo(56_827.5 + halfWidth, 6);
    expect(band?.lo.unit).toBe("m");
  });

  it("widens it with the square of how far the altitude was carried", () => {
    const s = scene();
    s.descend(SCATTERED_DESCENT);

    const near = altitudeBand(s.at(13));
    const far = altitudeBand(s.at(16));

    const nearWidth = (near?.hi.magnitude ?? 0) - (near?.lo.magnitude ?? 0);
    const farWidth = (far?.hi.magnitude ?? 0) - (far?.lo.magnitude ?? 0);
    /*
     * Three seconds out against six: the carry doubles and the interval
     * quadruples, because the fitted acceleration enters the altitude as
     * `0.5 a dt²`.
     */
    expect(nearWidth).toBeGreaterThan(0);
    expect(farWidth / nearWidth).toBeCloseTo(4, 6);
  });

  it("offers no band at exactly two samples, where the fit has no residual at all", () => {
    const s = scene();
    s.descend(SCATTERED_DESCENT.slice(2));

    const reading = s.at(13);

    // The last two instants only. Two points determine a line, so there is no
    // degree of freedom left to estimate a spread from. The model still
    // answers: two samples is its own declared floor, and what it withholds is
    // the CLAIM about how well it knows the answer, not the answer.
    expect(reading.reckoning.status).toBe("available");
    expect(reckonedAltitude(reading)).toBeDefined();
    expect(altitudeBand(reading)).toBeUndefined();
  });

  it("claims nothing where four samples sit on one straight line", () => {
    const s = scene();
    s.descend(LINEAR_IN_WINDOW);

    const reading = s.at(13);

    // Four samples and two degrees of freedom, so the arithmetic is available
    // and answers zero. A residual sum of squares of zero is a degenerate
    // estimate rather than evidence that an extrapolation is exact, and a
    // zero-width band would be read downstream as the second thing.
    // `ReckonedBands` would rather have none.
    expect(reading.reckoning.status).toBe("available");
    expect(altitudeBand(reading)).toBeUndefined();
  });

  it("claims nothing where the line the samples sit on is not one binary can land on", () => {
    const s = scene();
    s.descend(LINEAR_OFF_THE_BINARY_GRID);

    const reading = s.at(13);

    // The same degenerate fit as the case above, at an acceleration whose
    // decimal does not survive the trip into a double. The residuals are the
    // arithmetic's own rounding, about 2e-14 m/s against samples of 250, and a
    // withdrawal that asks whether they are exactly zero reads them as evidence:
    // what came out was a `sigma1` interval 3e-14 m wide, which a consumer draws
    // with both ends on the same number and captions as a one-sigma claim.
    expect(reading.reckoning.status).toBe("available");
    expect(reckonedAltitude(reading)).toBeCloseTo(56_826.6, 6);
    expect(altitudeBand(reading)).toBeUndefined();
  });

  it("claims nothing where that line sits at a campaign's UT rather than a fresh save's", () => {
    const s = scene();
    s.descend(LINEAR_AT_CAMPAIGN_UT);

    const reading = s.at(CAMPAIGN_UT + 13);

    // The residue of this perfect fit comes from `tBar` rather than from the
    // speeds, so a guard scaled by the speeds alone offers a 5.6e-10 m interval
    // here and misses every frame of the handover set for the same reason. UT is
    // the larger magnitude in the arithmetic on every save but a brand new one.
    expect(reading.reckoning.status).toBe("available");
    expect(reckonedAltitude(reading)).toBeCloseTo(56_827.5, 6);
    expect(altitudeBand(reading)).toBeUndefined();
  });

  it("still bands a fit whose residuals are faint and real", () => {
    const s = scene();
    s.descend(FAINTLY_SCATTERED);

    const band = altitudeBand(s.at(13));

    // A thousandth of `SCATTERED_DESCENT`'s scatter is eleven orders of
    // magnitude above the rounding of a 250 m/s sample, so it is the window
    // disagreeing with the line and the model owes an interval for it. The
    // half-width is the same `0.5 x sigma_a x dt²` divided by the same thousand.
    expect(band?.kind).toBe("sigma1");
    const halfWidth = (0.5 * SCATTERED_SIGMA * 3 * 3) / 1000;
    expect(band?.hi.magnitude).toBeCloseTo(56_827.5 + halfWidth, 9);
    expect(band?.lo.magnitude).toBeCloseTo(56_827.5 - halfWidth, 9);
  });

  it("hands the band to the plotted tail as well as to the point read", () => {
    const s = scene();
    s.descend(SCATTERED_DESCENT);
    s.at(16);

    const tail = s.store.sampleReckonedTail<Value<"m">>(
      "vessel.flight.altitudeAsl",
      0,
      16,
    );
    const last = tail[tail.length - 1];

    // The chart's half of the same claim, through `fieldScopedReckoner`, which
    // looks the band up at the EXACT field path rather than inheriting one.
    expect(last.bandKind).toBe("sigma1");
    expect(last.bandLo?.unit).toBe("m");
    expect(last.bandHi?.magnitude).toBeGreaterThan(last.value.magnitude);
  });
});

/**
 * The band's journey through the store's input-rule walk, driven by SYNTHETIC
 * models on the flight reckoner's two real declared inputs.
 *
 * Synthetic because nothing in the shipped tree models `vessel.orbit` or
 * `system.bodies`: `reckoner-input-rule-ledger.test.ts` pins that the set of
 * pairs either rule can act on is empty, and it stays empty after this change.
 * So every case here is about STRUCTURE, and none of it fires on a live client
 * today. What it is worth is that the day someone does model the body roster,
 * the altitude is already held to it.
 */
describe("the altitude band through the store's input-rule walk", () => {
  /** A model for one of the flight reckoner's inputs, reaching only to `horizonUt`. */
  function reachingTo(horizonUt: number) {
    return {
      deps: [] as const,
      reckon: (
        p: TimelinePoint<unknown>,
        _deps: unknown,
        frame: { viewUt: number },
      ) =>
        frame.viewUt > horizonUt
          ? {
              declined: {
                reason: "beyond-horizon" as const,
                note: "this input does not reach that far",
              },
            }
          : {
              modelled: [{ path: "", basis: "rate-integration" as const }],
              reckon: () => p.payload,
            },
    };
  }

  /** A model for one of those inputs, banding its own answer and counting the pulls. */
  function bandedBy(
    kind: "bound" | "sigma1",
    halfWidth: number,
    pulls: { count: number },
  ) {
    return {
      deps: [] as const,
      reckon: (p: TimelinePoint<unknown>) => ({
        modelled: [{ path: "", basis: "rate-integration" as const }],
        reckon: () => p.payload,
        bandAt: () => {
          pulls.count += 1;
          return {
            "": {
              value: value("m", 100),
              lo: value("m", 100 - halfWidth),
              hi: value("m", 100 + halfWidth),
              kind,
            },
          };
        },
      }),
    };
  }

  function widthOf(reading: TopicReading<FlightSample>): number | undefined {
    const band = altitudeBand(reading);
    return band && band.hi.magnitude - band.lo.magnitude;
  }

  it("reaches no further than the SHORTEST-reaching of its two declared inputs", () => {
    const s = scene();
    s.descend(SCATTERED_DESCENT);
    // The elements reach to 20 and the roster only to 12, so 13 is inside one
    // input and outside the other. Whichever runs out first is the one that
    // settles the altitude's reach.
    registerReckoner("vessel.orbit", "test-uplink", reachingTo(20));
    registerReckoner("system.bodies", "test-uplink", reachingTo(12));

    const reading = s.at(13);

    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "beyond-horizon", input: "@system.bodies" },
    });
  });

  it("still carries the altitude while both inputs reach", () => {
    const s = scene();
    s.descend(SCATTERED_DESCENT);
    registerReckoner("vessel.orbit", "test-uplink", reachingTo(20));
    registerReckoner("system.bodies", "test-uplink", reachingTo(12));

    // The control for the case above: one second earlier, nothing has run out
    // and the same frame is carried.
    expect(s.at(11).reckoning.status).toBe("available");
  });

  it("holds the band no narrower once an input declares an interval of its own", () => {
    const s = scene();
    s.descend(SCATTERED_DESCENT);
    const alone = widthOf(s.at(13));

    const t = scene();
    t.descend(SCATTERED_DESCENT);
    const pulls = { count: 0 };
    registerReckoner(
      "system.bodies",
      "test-uplink",
      bandedBy("sigma1", 40, pulls),
    );
    const withInput = widthOf(t.at(13));

    // The walk REACHED the input's own model, which is the structural claim,
    // and the altitude's interval is no narrower for it. It is not wider
    // either: the rule as settled polices the two claims that are wrong
    // whatever the mathematics (a bound out of a sigma, exactness out of an
    // inexact input) and leaves the width to the model, which here already
    // carries the only error it has evidence for.
    expect(pulls.count).toBeGreaterThan(0);
    expect(alone).toBeGreaterThan(0);
    expect(withInput).toBeGreaterThanOrEqual(alone as number);
  });

  it("never hardens its sigma into a bound because an input claims one", () => {
    const s = scene();
    s.descend(SCATTERED_DESCENT);
    const pulls = { count: 0 };
    registerReckoner(
      "system.bodies",
      "test-uplink",
      bandedBy("bound", 40, pulls),
    );

    // A model gains no confidence from an input that has more: the rule can
    // only soften a claim, never strengthen one.
    expect(altitudeBand(s.at(13))?.kind).toBe("sigma1");
  });
});
