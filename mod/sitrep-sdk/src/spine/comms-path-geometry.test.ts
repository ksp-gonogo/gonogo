import { describe, expect, it } from "vitest";
import type {
  BodyEntry,
  CommandCentreEntry,
  CommsHop,
} from "../__generated__/contract";
import { CommsHopKind } from "../__generated__/contract";
import { type CelestialFacts, deriveCelestialFacts } from "./celestial-facts";
import {
  bodyRotationAngleDegAt,
  type CommsPeerEndpoint,
  type CommsPeerLocation,
  type CommsPeerOrbit,
  commsPeerPositionAt,
  firstHopPeer,
  locateCommsPeer,
  surfacePositionAt,
} from "./comms-path-geometry";
import type { Vector3 } from "./kepler";
import { magnitude } from "./kepler-reckoning";
import { systemInstantAt } from "./reference-frame";

const STAR_MU = 1.1723328e18;
const PLANET_MU = 3.5316e12;
const PLANET_RADIUS = 600_000;
const PLANET_SMA = 1.359984e10;
const SIDEREAL_DAY = 21_549.425;

function value(magnitude: number) {
  return { magnitude } as BodyEntry["gravParameter"];
}

/**
 * Star at the origin, one rotating planet about it. The planet's phase is a
 * fixture input rather than a constant, because the whole point of the field
 * under test is that the phase is not derivable from the period.
 */
function catalogue(
  options: { initialRotationDeg?: number | null } = {},
): CelestialFacts {
  const { initialRotationDeg = 0 } = options;
  const star = {
    index: 0,
    name: "Star",
    gravParameter: value(STAR_MU),
  } as BodyEntry;
  const planet = {
    index: 1,
    name: "Planet",
    parentIndex: 0,
    radius: value(PLANET_RADIUS),
    gravParameter: value(PLANET_MU),
    rotationPeriod: value(SIDEREAL_DAY),
    initialRotation:
      initialRotationDeg === null ? undefined : value(initialRotationDeg),
    orbit: {
      sma: value(PLANET_SMA),
      ecc: value(0),
      inc: value(0),
      lan: value(0),
      argPe: value(0),
      meanAnomalyAtEpoch: value(0),
      epoch: value(0),
    },
  } as BodyEntry;
  return deriveCelestialFacts([star, planet], 0);
}

function planetOf(facts: CelestialFacts) {
  const planet = facts.bodies.find((b) => b.index === 1);
  if (planet === undefined) throw new Error("fixture has no planet");
  return planet;
}

/** One station on the planet, named exactly as a hop names it. */
const STATION: CommandCentreEntry = {
  id: "ground:Kourou",
  displayName: "Kourou",
  kind: "GroundStation",
  bodyIndex: 1,
  latitude: value(0),
  longitude: value(0),
  active: true,
  delayQuality: "routed",
} as CommandCentreEntry;

/** A relay in a circular equatorial orbit about the planet. */
const RELAY_GUID = "8f0d2d3c-0000-4000-8000-000000000001";
const RELAY_SMA = 2_863_330;
const RELAY_ORBIT: CommsPeerOrbit = {
  referenceBodyIndex: 1,
  sma: value(RELAY_SMA),
  ecc: value(0),
  inc: value(0),
  lan: value(0),
  argPe: value(0),
  meanAnomalyAtEpoch: value(0),
  epoch: value(0),
  mu: value(PLANET_MU),
};

function hop(to: string, toIsHome: boolean): CommsHop {
  return {
    from: "00000000-0000-4000-8000-00000000000c",
    to,
    fromIsHome: false,
    toIsHome,
    kind: toIsHome ? CommsHopKind.Home : CommsHopKind.Relay,
    distanceMeters: value(1_000_000),
  } as CommsHop;
}

const noOrbits = () => undefined;
const relayOrbits = (id: string) =>
  id === RELAY_GUID ? RELAY_ORBIT : undefined;

/** A vector the code under test refused is a failed assertion, not a null deref. */
function present(v: Vector3 | null | undefined): Vector3 {
  if (v == null) throw new Error("expected a vector, got a refusal");
  return v;
}

function presentPeer(p: CommsPeerEndpoint | null): CommsPeerEndpoint {
  if (p === null) throw new Error("expected a first-hop peer, got none");
  return p;
}

function presentLocation(p: CommsPeerLocation | null): CommsPeerLocation {
  if (p === null) throw new Error("expected a located peer, got a refusal");
  return p;
}

function separation(a: Vector3, b: Vector3): number {
  return magnitude([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
}

describe("a body's rotation phase", () => {
  it("turns with the period from the published phase", () => {
    const planet = planetOf(catalogue({ initialRotationDeg: 30 }));
    expect(bodyRotationAngleDegAt(planet, 0)).toBeCloseTo(30, 9);
    expect(bodyRotationAngleDegAt(planet, SIDEREAL_DAY / 4)).toBeCloseTo(
      120,
      9,
    );
  });

  it("refuses when the wire carried no phase, rather than assuming zero", () => {
    const planet = planetOf(catalogue({ initialRotationDeg: null }));
    /*
     * The rate is known and the phase is not, which is exactly the state the
     * wire was in before `initialRotation`: a period alone cannot place a point
     * on a sphere.
     */
    expect(planet.rotationPeriod).toBeCloseTo(SIDEREAL_DAY, 6);
    expect(bodyRotationAngleDegAt(planet, 0)).toBeNull();
    expect(surfacePositionAt(planet, 0, 0, 0, 0)).toBeNull();
  });
});

describe("a surface point at a view time", () => {
  it("sits where the published phase puts it, not where the period alone would", () => {
    const atZeroPhase = planetOf(catalogue({ initialRotationDeg: 0 }));
    const atQuarterPhase = planetOf(catalogue({ initialRotationDeg: 90 }));

    const unturned = present(surfacePositionAt(atZeroPhase, 0, 0, 0, 0));
    const turned = present(surfacePositionAt(atQuarterPhase, 0, 0, 0, 0));

    // Same body, same station, same instant: the phase is the only difference,
    // and a quarter turn of it moves the station a quarter of the way round.
    expect(unturned[0]).toBeCloseTo(PLANET_RADIUS, 3);
    expect(unturned[1]).toBeCloseTo(0, 3);
    expect(turned[0]).toBeCloseTo(0, 3);
    expect(turned[1]).toBeCloseTo(PLANET_RADIUS, 3);
  });

  it("carries a station round the body as the view time advances", () => {
    const planet = planetOf(catalogue({ initialRotationDeg: 0 }));
    const quarter = present(
      surfacePositionAt(planet, 0, 0, 0, SIDEREAL_DAY / 4),
    );
    const half = present(surfacePositionAt(planet, 0, 0, 0, SIDEREAL_DAY / 2));
    expect(quarter[0]).toBeCloseTo(0, 3);
    expect(quarter[1]).toBeCloseTo(PLANET_RADIUS, 3);
    expect(half[0]).toBeCloseTo(-PLANET_RADIUS, 3);
    expect(half[1]).toBeCloseTo(0, 3);
  });

  it("puts the pole on the rotation axis, where no phase can move it", () => {
    const planet = planetOf(catalogue({ initialRotationDeg: 137 }));
    const pole = present(surfacePositionAt(planet, 90, 0, 0, 5_000));
    expect(pole[0]).toBeCloseTo(0, 3);
    expect(pole[1]).toBeCloseTo(0, 3);
    expect(pole[2]).toBeCloseTo(PLANET_RADIUS, 3);
  });
});

describe("the first hop's peer", () => {
  it("is the far end of hop zero, never the command centre", () => {
    const hops = [hop(RELAY_GUID, false), hop("Kourou", true)];
    expect(firstHopPeer(hops)).toEqual({ id: RELAY_GUID, isHome: false });
  });

  it("is absent when there is no path home", () => {
    expect(firstHopPeer([])).toBeNull();
    expect(firstHopPeer(undefined)).toBeNull();
  });
});

describe("a first-hop peer's position at view time", () => {
  it("places a ground station on the turning body, from published data alone", () => {
    const facts = catalogue({ initialRotationDeg: 0 });
    const peer = presentPeer(firstHopPeer([hop("Kourou", true)]));
    const located = presentLocation(locateCommsPeer(peer, [STATION], noOrbits));
    expect(located).toEqual({
      kind: "surface",
      bodyIndex: 1,
      latitudeDeg: 0,
      longitudeDeg: 0,
      altitudeMetres: 0,
    });

    const ut = SIDEREAL_DAY / 4;
    const system = systemInstantAt(facts, ut);
    const position = present(commsPeerPositionAt(located, facts, system, ut));

    // Root-centred: the planet's own position plus a quarter-turned surface
    // point. Subtracting the planet leaves the body-centred vector.
    const planetAt = present(system.positionByIndex.get(1));
    const local: Vector3 = [
      position[0] - planetAt[0],
      position[1] - planetAt[1],
      position[2] - planetAt[2],
    ];
    expect(local[0]).toBeCloseTo(0, 3);
    expect(local[1]).toBeCloseTo(PLANET_RADIUS, 3);
    expect(magnitude(local)).toBeCloseTo(PLANET_RADIUS, 3);
  });

  it("moves the station between two view times a quarter-day apart", () => {
    const facts = catalogue({ initialRotationDeg: 0 });
    const located = presentLocation(
      locateCommsPeer(
        presentPeer(firstHopPeer([hop("Kourou", true)])),
        [STATION],
        noOrbits,
      ),
    );
    const early = present(
      commsPeerPositionAt(located, facts, systemInstantAt(facts, 0), 0),
    );
    const quarterDay = SIDEREAL_DAY / 4;
    const late = present(
      commsPeerPositionAt(
        located,
        facts,
        systemInstantAt(facts, quarterDay),
        quarterDay,
      ),
    );
    // The station itself swept a quarter of the equator; the planet also moved
    // along its own orbit, so this is a floor rather than an equality.
    expect(separation(late, early)).toBeGreaterThan(PLANET_RADIUS);
  });

  it("places a relay peer from its own fleet orbit", () => {
    const facts = catalogue({ initialRotationDeg: 0 });
    const located = presentLocation(
      locateCommsPeer(
        presentPeer(
          firstHopPeer([hop(RELAY_GUID, false), hop("Kourou", true)]),
        ),
        [STATION],
        relayOrbits,
      ),
    );
    expect(located).toMatchObject({ kind: "orbiting", bodyIndex: 1 });

    const ut = 1_234;
    const system = systemInstantAt(facts, ut);
    const position = present(commsPeerPositionAt(located, facts, system, ut));
    const planetAt = present(system.positionByIndex.get(1));
    expect(separation(position, planetAt)).toBeCloseTo(RELAY_SMA, 3);
  });

  it("refuses a station whose body never published a phase", () => {
    const facts = catalogue({ initialRotationDeg: null });
    const located = presentLocation(
      locateCommsPeer(
        presentPeer(firstHopPeer([hop("Kourou", true)])),
        [STATION],
        noOrbits,
      ),
    );
    expect(
      commsPeerPositionAt(located, facts, systemInstantAt(facts, 0), 0),
    ).toBeNull();
  });

  it("refuses a centre the roster gave no coordinates", () => {
    // The roster's documented null case: a crewed-vessel centre off the ground
    // reports no latitude, so there is no surface point to turn.
    const airborne = {
      ...STATION,
      latitude: undefined,
      longitude: undefined,
    } as CommandCentreEntry;
    expect(
      locateCommsPeer({ id: "Kourou", isHome: true }, [airborne], noOrbits),
    ).toBeNull();
  });

  it("refuses a peer no roster and no fleet orbit names", () => {
    expect(
      locateCommsPeer({ id: "Canberra", isHome: true }, [STATION], noOrbits),
    ).toBeNull();
    expect(
      locateCommsPeer({ id: "no-such-guid", isHome: false }, [], noOrbits),
    ).toBeNull();
  });
});
