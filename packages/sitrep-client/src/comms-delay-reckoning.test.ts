import type {
  BodyEntry,
  CommandCentreEntry,
  CommsHop,
} from "@ksp-gonogo/sitrep-sdk";
import { CommsDelaySource, CommsHopKind, value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { TopicReading } from "./reading";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * `comms.delay`, carried forward by re-measuring the FIRST hop and nothing else.
 *
 * Every hop but the first joins two things that do not move relative to each
 * other on a telemetry timescale, so the length the mod measured for them is
 * still the length now. The craft is the end that has moved since the light
 * left, so the leg with the craft on it is the only one worth re-deriving, and
 * the rest of the route carries forward as the sum it already was.
 *
 * The fixtures below are built so the expected numbers can be WRITTEN DOWN
 * rather than recomputed by the code under test: one root planet at the origin,
 * a circular equatorial craft orbit, a relay whose period is exactly twice the
 * craft's, and a rotation period four times the craft's. At half a craft period
 * every body involved is at an angle with an exact cosine.
 */

const PLANET_INDEX = 1;
const PLANET_RADIUS = 600_000;
const PLANET_MU = 3.5316e12;

const CRAFT_SMA = 2_000_000;
const CRAFT_PERIOD = 2 * Math.PI * Math.sqrt(CRAFT_SMA ** 3 / PLANET_MU);

/** `a ∝ T^(2/3)`, so a relay one cube-root-of-four out orbits half as often. */
const RELAY_SMA = CRAFT_SMA * Math.cbrt(4);
const RELAY_GUID = "8f0d2d3c-0000-4000-8000-000000000001";

/** Deliberately NOT a multiple of the craft's period: the station has to move. */
const ROTATION_PERIOD = 4 * CRAFT_PERIOD;

/** The mod's own constant (`Sitrep.Host.Comms.SignalDelay`), at scale 1. */
const C = 299_792_458;

/** Half a craft period: craft at 180°, relay at 90°, station at 45°. */
const HALF_ORBIT = CRAFT_PERIOD / 2;

const STATION_NAME = "Kourou";

function wire(magnitude: number) {
  return { magnitude } as BodyEntry["gravParameter"];
}

const PLANET = {
  index: PLANET_INDEX,
  name: "Kerbin",
  radius: wire(PLANET_RADIUS),
  gravParameter: wire(PLANET_MU),
  rotationPeriod: wire(ROTATION_PERIOD),
  initialRotation: wire(0),
} as BodyEntry;

const SYSTEM = { bodies: [PLANET] };

const ROSTER: CommandCentreEntry[] = [
  {
    id: `ground:${STATION_NAME}`,
    displayName: STATION_NAME,
    kind: "GroundStation",
    bodyIndex: PLANET_INDEX,
    latitude: wire(0),
    longitude: wire(0),
    active: true,
    isHome: true,
  } as CommandCentreEntry,
];

/** A circular equatorial orbit with the body at the origin: at UT 0 it is at +X. */
function circularOrbit(sma: number) {
  return {
    referenceBodyIndex: PLANET_INDEX,
    sma: value("m", sma),
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

const CRAFT_GUID = "00000000-0000-4000-8000-00000000000c";

function hop(to: string, toIsHome: boolean, distanceMetres: number): CommsHop {
  return {
    from: CRAFT_GUID,
    to,
    fromIsHome: false,
    toIsHome,
    kind: toIsHome ? CommsHopKind.Home : CommsHopKind.Relay,
    distanceMeters: value("m", distanceMetres),
  } as CommsHop;
}

/** The one-hop route: craft straight to a ground station. */
const DIRECT_HOPS = [
  hop(STATION_NAME, true, CRAFT_SMA - PLANET_RADIUS),
] as const;

/** The two-hop route: craft to a relay, relay to the same station. */
const RELAYED_HOPS = [
  hop(RELAY_GUID, false, RELAY_SMA - CRAFT_SMA),
  hop(STATION_NAME, true, RELAY_SMA - PLANET_RADIUS),
] as const;

function routeMetres(hops: readonly CommsHop[]): number {
  return hops.reduce((sum, h) => sum + (h.distanceMeters?.magnitude ?? 0), 0);
}

interface DelaySample {
  oneWaySeconds?: { magnitude: number };
  source: CommsDelaySource;
}

function point<T>(validAt: number, payload: T): TimelinePoint<T> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt, source: "vessel:probe" }),
    epoch: 0,
  };
}

/**
 * A store holding one observation of every input, with the transport DOWN so a
 * read past the observation grades stale rather than waiting out a heartbeat.
 */
function scene(
  hops: readonly CommsHop[],
  options: { source?: CommsDelaySource; observedAt?: number } = {},
) {
  const { source = CommsDelaySource.SignalDelay, observedAt = 0 } = options;
  let wall = observedAt;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  clock.setMode("predicted");
  const store = new TimelineStore(clock);
  store.setTransportConnected(false);
  store.ingest("system.bodies", point(observedAt, SYSTEM));
  store.ingest("commandCentre.roster", point(observedAt, ROSTER));
  store.ingest("vessel.orbit", point(observedAt, circularOrbit(CRAFT_SMA)));
  store.ingest("comms.path", point(observedAt, { hops: [...hops] }));
  store.ingest(
    "comms.delay",
    point(observedAt, {
      oneWaySeconds: value("s", routeMetres(hops) / C),
      source,
    }),
  );
  return {
    store,
    /** Re-emit the route alone, as the change-gate does when only a hop's extension bag moved. */
    repeatRoute(at: number) {
      wall = at;
      store.ingest("comms.path", point(at, { hops: [...hops] }));
    },
    at(viewUt: number): TopicReading<DelaySample> {
      wall = viewUt;
      store.beginFrame();
      return store.sampleReading<DelaySample>("comms.delay");
    },
  };
}

/** The reckoned one-way delay, or `undefined` where the model withdrew. */
function reckonedSeconds(
  reading: TopicReading<DelaySample>,
): number | undefined {
  return reading.reckoning.status === "available"
    ? reading.reckoning.value.oneWaySeconds?.magnitude
    : undefined;
}

beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

describe("a direct link to a ground station", () => {
  it("reads back the observed delay at the instant it was observed", () => {
    const s = scene(DIRECT_HOPS);
    const reading = s.at(0);

    expect(reading.reckoning.status).toBe("available");
    // The craft and the station are where they were when the light left, so the
    // re-measured first hop IS the measured one and the model reproduces the
    // observation exactly. Continuity at the anchor, not a coincidence of this
    // fixture: the substitution subtracts and re-adds the same leg.
    expect(reckonedSeconds(reading)).toBeCloseTo(
      (CRAFT_SMA - PLANET_RADIUS) / C,
      12,
    );
  });

  it("follows the craft round its orbit, and the station round the body", () => {
    const s = scene(DIRECT_HOPS);
    const reading = s.at(HALF_ORBIT);

    // Half a craft period on: the craft is at 180° (-X) and the station, on a
    // body turning four times slower, is at 45°.
    const station = PLANET_RADIUS * Math.SQRT1_2;
    const expected = Math.hypot(CRAFT_SMA + station, station) / C;

    expect(reading.reckoning.status).toBe("available");
    expect(reckonedSeconds(reading)).toBeCloseTo(expected, 12);
    expect(
      reading.reckoning.status === "available"
        ? reading.reckoning.basis
        : undefined,
    ).toBe("kepler-propagation");
  });

  it("pairs the current route with the current delay across a change-gated tick", () => {
    const s = scene(DIRECT_HOPS);
    // The route re-emits on its own, which is what happens when a hop's
    // provider extension bag moved and its length did not. The delay is gated
    // out of that tick precisely BECAUSE the total is unchanged, so the two
    // points now carry different instants and still describe one geometry.
    s.repeatRoute(HALF_ORBIT / 2);

    const station = PLANET_RADIUS * Math.SQRT1_2;
    const reading = s.at(HALF_ORBIT);

    expect(reading.reckoning.status).toBe("available");
    expect(reckonedSeconds(reading)).toBeCloseTo(
      Math.hypot(CRAFT_SMA + station, station) / C,
      12,
    );
  });

  it("withdraws when the delay on the wire is a configured zero, not a light-time", () => {
    const s = scene(DIRECT_HOPS, { source: CommsDelaySource.NoCommsModel });
    const reading = s.at(HALF_ORBIT);

    // A save with no comms model reports 0 with `connected: true`. Carrying a
    // light-time forward from it would invent a delay the operator has switched
    // off, which is a worse answer than none.
    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: { reason: "model-inapplicable", input: "source" },
    });
  });
});

describe("a relayed link", () => {
  it("withdraws, naming the per-vessel orbit topic a reckoner cannot declare", () => {
    const s = scene(RELAYED_HOPS);
    const reading = s.at(HALF_ORBIT);

    // The relay's elements ride `fleet.<guid>.orbit`, a per-vessel dynamic
    // topic. A reckoner's inputs are declared once at registration, so there is
    // no dep that names it and no honest way to place the relay. The refusal
    // says which input, spelled as the wire spells it.
    expect(reading.reckoning.status).toBe("declined");
    expect(reading.reckoning).toMatchObject({
      status: "declined",
      declined: {
        reason: "input-absent",
        input: `@fleet.${RELAY_GUID}.orbit`,
      },
    });
  });
});
