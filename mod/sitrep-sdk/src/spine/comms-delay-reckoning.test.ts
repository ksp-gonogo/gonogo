import { describe, expect, it } from "vitest";
import type {
  BodyEntry,
  CommandCentreEntry,
  CommsHop,
} from "../__generated__/contract";
import { CommsDelaySource, CommsHopKind } from "../__generated__/contract";
import { deriveCelestialFacts } from "./celestial-facts";
import {
  type CommsDelayFit,
  commsDelaySecondsAt,
  fitCommsDelay,
} from "./comms-delay-reckoning";
import {
  type CommsPeerLocation,
  type CommsPeerOrbit,
  commsPeerPositionAt,
  firstHopPeer,
  locateCommsPeer,
} from "./comms-path-geometry";
import { magnitude } from "./kepler-reckoning";
import { systemInstantAt } from "./reference-frame";

/**
 * The first-hop substitution, against geometry whose answers can be written
 * down rather than recomputed by the code under test.
 *
 * One planet at the origin, a craft in a circular equatorial orbit, a relay one
 * cube-root-of-four further out (so its period is exactly twice the craft's),
 * and a rotation period four times the craft's. Half a craft period on, the
 * craft is at 180°, the relay at 90° and the station at 45°, so every expected
 * separation below is a `hypot` of two exact numbers.
 */

const PLANET_INDEX = 1;
const PLANET_RADIUS = 600_000;
const PLANET_MU = 3.5316e12;

const CRAFT_SMA = 2_000_000;
const CRAFT_PERIOD = 2 * Math.PI * Math.sqrt(CRAFT_SMA ** 3 / PLANET_MU);
const RELAY_SMA = CRAFT_SMA * Math.cbrt(4);
const ROTATION_PERIOD = 4 * CRAFT_PERIOD;
const HALF_ORBIT = CRAFT_PERIOD / 2;

const C = 299_792_458;

const RELAY_GUID = "8f0d2d3c-0000-4000-8000-000000000001";
const STATION_NAME = "Kourou";
const CRAFT_GUID = "00000000-0000-4000-8000-00000000000c";

function wire(magnitude: number) {
  return { magnitude } as BodyEntry["gravParameter"];
}

const FACTS = deriveCelestialFacts(
  [
    {
      index: PLANET_INDEX,
      name: "Kerbin",
      radius: wire(PLANET_RADIUS),
      gravParameter: wire(PLANET_MU),
      rotationPeriod: wire(ROTATION_PERIOD),
      initialRotation: wire(0),
    } as BodyEntry,
  ],
  0,
);

function circularOrbit(sma: number): CommsPeerOrbit {
  return {
    referenceBodyIndex: PLANET_INDEX,
    sma: wire(sma),
    ecc: wire(0),
    inc: wire(0),
    lan: wire(0),
    argPe: wire(0),
    meanAnomalyAtEpoch: wire(0),
    epoch: wire(0),
    mu: wire(PLANET_MU),
  };
}

const CRAFT = circularOrbit(CRAFT_SMA);
const RELAY_ORBIT = circularOrbit(RELAY_SMA);

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

const relayOrbits = (id: string) =>
  id === RELAY_GUID ? RELAY_ORBIT : undefined;

function hop(to: string, toIsHome: boolean, distanceMetres: number): CommsHop {
  return {
    from: CRAFT_GUID,
    to,
    fromIsHome: false,
    toIsHome,
    kind: toIsHome ? CommsHopKind.Home : CommsHopKind.Relay,
    distanceMeters: wire(distanceMetres),
  } as CommsHop;
}

/** Craft straight to the station, both at +X when the light left. */
const DIRECT: CommsHop[] = [hop(STATION_NAME, true, CRAFT_SMA - PLANET_RADIUS)];

/** Craft to a relay, relay to the same station, all three at +X. */
const RELAYED: CommsHop[] = [
  hop(RELAY_GUID, false, RELAY_SMA - CRAFT_SMA),
  hop(STATION_NAME, true, RELAY_SMA - PLANET_RADIUS),
];

function routeMetres(hops: readonly CommsHop[]): number {
  return hops.reduce((sum, h) => sum + (h.distanceMeters?.magnitude ?? 0), 0);
}

function located(hops: readonly CommsHop[]): CommsPeerLocation {
  const peer = firstHopPeer(hops);
  if (peer === null) throw new Error("fixture has no first hop");
  const location = locateCommsPeer(peer, ROSTER, relayOrbits);
  if (location === null) throw new Error("fixture peer is not locatable");
  return location;
}

/** A fit over one route, with the delay the mod would have published for it. */
function fit(
  hops: readonly CommsHop[],
  options: { source?: CommsDelaySource; lightSpeedScale?: number } = {},
): CommsDelayFit {
  const { source = CommsDelaySource.SignalDelay, lightSpeedScale = 1 } =
    options;
  const answer = fitCommsDelay({
    hops,
    observed: {
      oneWaySeconds: routeMetres(hops) / (C * lightSpeedScale),
      source,
    },
    craft: CRAFT,
    peer: located(hops),
    facts: FACTS,
  });
  if ("declined" in answer) {
    throw new Error(`expected a fit, got ${answer.declined.reason}`);
  }
  return answer;
}

function declineOf(
  hops: readonly CommsHop[],
  options: { source?: CommsDelaySource } = {},
) {
  const answer = fitCommsDelay({
    hops,
    observed: {
      oneWaySeconds: routeMetres(hops) / C,
      source: options.source ?? CommsDelaySource.SignalDelay,
    },
    craft: CRAFT,
    peer: located(DIRECT),
    facts: FACTS,
  });
  return "declined" in answer ? answer.declined : undefined;
}

/** Where a located peer actually is, for a fixture that has to disagree with it. */
function peerAt(location: CommsPeerLocation, ut: number) {
  const position = commsPeerPositionAt(
    location,
    FACTS,
    systemInstantAt(FACTS, ut),
    ut,
  );
  if (position === null) throw new Error("fixture peer is not placeable");
  return position;
}

describe("a first hop ending at a ground station", () => {
  it("reproduces the observation at the instant it was observed", () => {
    // The craft and the station have not moved, so the leg the model subtracts
    // and the leg it adds back are the same leg. That continuity is the reason
    // the rate comes from the observation rather than from a constant.
    expect(commsDelaySecondsAt(fit(DIRECT), 0)).toBeCloseTo(
      (CRAFT_SMA - PLANET_RADIUS) / C,
      12,
    );
  });

  it("follows the craft round its orbit and the station round the body", () => {
    const station = PLANET_RADIUS * Math.SQRT1_2;
    expect(commsDelaySecondsAt(fit(DIRECT), HALF_ORBIT)).toBeCloseTo(
      Math.hypot(CRAFT_SMA + station, station) / C,
      12,
    );
  });

  it("scales by the speed the observation implies, not by c", () => {
    // A save at half light-speed reports twice the delay for the same route.
    // Nothing on the wire says so, and the model does not need to be told: the
    // observed delay over the observed route IS that speed, reciprocated.
    const halfLight = fit(DIRECT, { lightSpeedScale: 0.5 });
    const station = PLANET_RADIUS * Math.SQRT1_2;
    expect(commsDelaySecondsAt(halfLight, HALF_ORBIT)).toBeCloseTo(
      (2 * Math.hypot(CRAFT_SMA + station, station)) / C,
      12,
    );
  });
});

describe("a first hop ending at a relay", () => {
  it("re-measures the craft's leg and carries the rest of the route unchanged", () => {
    const measuredSecondHop = RELAY_SMA - PLANET_RADIUS;
    // Craft at 180°, relay at 90°: the leg between them is a right angle.
    const expected = (measuredSecondHop + Math.hypot(CRAFT_SMA, RELAY_SMA)) / C;

    expect(commsDelaySecondsAt(fit(RELAYED), HALF_ORBIT)).toBeCloseTo(
      expected,
      12,
    );
  });

  it("leaves the relay-to-station leg at its measured length even though it moved", () => {
    // The assertion above is only worth anything if the carried-forward hop is
    // not accidentally still correct: the relay is a quarter of its orbit round
    // and the station an eighth of a day round, so their true separation has
    // moved by over two hundred kilometres. A model that re-measured the whole
    // route would answer a different number.
    const relay = peerAt(located(RELAYED), HALF_ORBIT);
    const station = peerAt(located(DIRECT), HALF_ORBIT);
    const trueSecondHop = magnitude([
      relay[0] - station[0],
      relay[1] - station[1],
      relay[2] - station[2],
    ]);

    expect(
      Math.abs(trueSecondHop - (RELAY_SMA - PLANET_RADIUS)),
    ).toBeGreaterThan(100_000);
  });
});

describe("what the model refuses", () => {
  it("refuses a route with no hops, having no leg to re-measure", () => {
    expect(declineOf([])).toMatchObject({
      reason: "model-inapplicable",
      input: "@comms.path",
    });
  });

  it("refuses a hop that carries no distance, rather than reading it as zero", () => {
    const incomplete = [
      { ...DIRECT[0], distanceMeters: undefined } as CommsHop,
    ];
    expect(declineOf(incomplete)).toMatchObject({
      reason: "input-absent",
      input: "@comms.path",
    });
  });

  it("refuses a configured zero, which no amount of craft motion changes", () => {
    for (const source of [
      CommsDelaySource.None,
      CommsDelaySource.Simulation,
      CommsDelaySource.NoCommsModel,
    ]) {
      expect(declineOf(DIRECT, { source })).toMatchObject({
        reason: "model-inapplicable",
        input: "source",
      });
    }
  });
});
