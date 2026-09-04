import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { makeMeta, type WireOf, wrapWire } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";
import {
  deriveVesselState,
  deriveVesselStateReckoning,
  type SystemBodiesPayload,
  type VesselOrbitPayload,
} from "./vessel-state";

/**
 * Where the conic stops being a description of what happens: the air.
 *
 * `kepler-propagation` says in its own words that it holds "until a burn, an
 * SOI change or a perturbation the propagator does not model". Atmospheric
 * drag is the third of those, named in the type and never checked. So a craft
 * whose elements carry it below the entry interface was propagated straight
 * through the atmosphere, and a chart of `vessel.state.altitudeAsl` drew that
 * as a smooth symmetric dip with the same dashes it uses for a vacuum coast.
 *
 * The horizon is the same SHAPE as the SOI one next to it: a fact off the
 * wire, not a constant, and the model withdraws by declining rather than by
 * degrading. `system.bodies` already carries the radius and the atmosphere
 * depth per body.
 */

const KERBIN_RADIUS = 600_000;
const KERBIN_ATMOSPHERE_DEPTH = 70_000;
const MU_KERBIN = 3.5316e12;

/**
 * Apoapsis 800 km from the centre, periapsis 630 km: 200 km of altitude at the
 * top and 30 km at the bottom, so the arc passes through Kerbin's 70 km
 * interface on the way down and is well clear of the surface at every instant.
 * That separation is the point: an atmospheric horizon and a surface-impact
 * horizon have to be distinguishable, and this orbit crosses exactly one.
 *
 * `meanAnomalyAtEpoch: PI` starts it at apoapsis, so UT 0 is the honest end of
 * the arc and half a period later is the dishonest one.
 */
const ENTRY_ARC: WireOf<VesselOrbitPayload> = {
  referenceBodyIndex: 1,
  sma: 715_000,
  ecc: 170_000 / 1_430_000,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: Math.PI,
  epoch: 0,
  mu: MU_KERBIN,
  /*
   * What the stock producer always fills (`AnalyticHorizon()` in
   * `VesselViewProvider`), reach AND shape. Not nullable on the wire, so a
   * fixture that omits it records a producer that dropped a required field.
   */
  horizon: { kind: 1, trajectoryKind: 1 },
};

/** Periapsis 500 km, which is 100 km INSIDE Kerbin. The conic aims at rock. */
const IMPACT_ARC: WireOf<VesselOrbitPayload> = {
  ...ENTRY_ARC,
  sma: 650_000,
  ecc: 150_000 / 1_300_000,
};

/** Half the period of `ENTRY_ARC`: the instant it reaches periapsis. */
const PERIAPSIS_UT = Math.PI * Math.sqrt(715_000 ** 3 / MU_KERBIN);

function orbitPoint(
  wire: WireOf<VesselOrbitPayload>,
  validAt = 0,
): TimelinePoint<VesselOrbitPayload> {
  return {
    validAt,
    payload: wrapWire<VesselOrbitPayload>("VesselOrbit", { ...wire }),
    meta: makeMeta({
      validAt,
      quality: Quality.OnRails,
      source: "vessel:abc-123",
    }),
    epoch: 0,
  };
}

/** `atmosphere` omitted is the wire's own way of saying the body is airless. */
function bodies(opts: { atmosphere: boolean }): SystemBodiesPayload {
  return {
    bodies: [
      {
        name: "Kerbin",
        index: 1,
        parentIndex: 0,
        radius: KERBIN_RADIUS,
        orbit: null,
        ...(opts.atmosphere
          ? { atmosphere: { depth: KERBIN_ATMOSPHERE_DEPTH } }
          : {}),
      },
    ],
  };
}

function getWith(points: {
  orbit: TimelinePoint<VesselOrbitPayload>;
  bodies?: SystemBodiesPayload | null;
}): DerivedGet {
  const map: Record<string, TimelinePoint<unknown> | undefined> = {
    "vessel.orbit": points.orbit,
  };
  if (points.bodies !== undefined) {
    map["system.bodies"] = {
      validAt: 0,
      payload: points.bodies,
      meta: makeMeta({
        validAt: 0,
        quality: Quality.OnRails,
        source: "system",
      }),
      epoch: 0,
    };
  }
  return (<T>(topic: string) =>
    map[topic] as TimelinePoint<T> | undefined) as DerivedGet;
}

describe("deriveVesselStateReckoning: the atmospheric interface", () => {
  it("still propagates while the arc is above the interface", () => {
    const get = getWith({
      orbit: orbitPoint(ENTRY_ARC),
      bodies: bodies({ atmosphere: true }),
    });

    // UT 0 is apoapsis, 200 km up: nothing but vacuum between here and there.
    expect(deriveVesselStateReckoning(get, 0)).toBeDefined();
  });

  it("declines once the arc has carried the craft into the air", () => {
    const get = getWith({
      orbit: orbitPoint(ENTRY_ARC),
      bodies: bodies({ atmosphere: true }),
    });

    // Periapsis is 30 km up, 40 km inside the interface. A conic has no drag
    // term, so what it draws here is not what happens here.
    expect(deriveVesselStateReckoning(get, PERIAPSIS_UT)).toBeUndefined();
  });

  it("keeps propagating the same arc around an AIRLESS body", () => {
    const get = getWith({
      orbit: orbitPoint(ENTRY_ARC),
      bodies: bodies({ atmosphere: false }),
    });

    // One field apart from the case above, and the opposite answer: with no
    // air a 30 km periapsis is just a low periapsis, and the conic is right.
    expect(deriveVesselStateReckoning(get, PERIAPSIS_UT)).toBeDefined();
  });

  it("declines on an arc that reaches the SURFACE of an airless body", () => {
    const get = getWith({
      orbit: orbitPoint(IMPACT_ARC),
      bodies: bodies({ atmosphere: false }),
    });

    // The floor is the ground when there is no air above it. A coast that
    // continues below the surface is a claim about a crater.
    const impactSide = Math.PI * Math.sqrt(650_000 ** 3 / MU_KERBIN);
    expect(deriveVesselStateReckoning(get, impactSide)).toBeUndefined();
  });

  it("propagates unchanged when the body table has not arrived", () => {
    const get = getWith({ orbit: orbitPoint(ENTRY_ARC) });

    /*
     * Declining takes positive evidence, the same posture the delay model
     * takes to declare a command lost. With no roster there is no interface to
     * have crossed, and refusing on an absent fact would blank every
     * propagated reading for the frames before the once-a-second roster lands.
     */
    expect(deriveVesselStateReckoning(get, PERIAPSIS_UT)).toBeDefined();
  });

  it("propagates unchanged when the body carries no radius yet", () => {
    const get = getWith({
      orbit: orbitPoint(ENTRY_ARC),
      bodies: {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: null,
            orbit: null,
          },
        ],
      },
    });

    expect(deriveVesselStateReckoning(get, PERIAPSIS_UT)).toBeDefined();
  });
});

describe("vessel.state.altitudeAsl on the propagated basis", () => {
  it("is the solved radius less the reference body's, not null", () => {
    const get = getWith({
      orbit: orbitPoint(ENTRY_ARC),
      bodies: bodies({ atmosphere: true }),
    });

    const state = deriveVesselState(get, 0);

    // Apoapsis: 800 km from the centre of a 600 km body.
    expect(state?.altitudeAsl).toBeCloseTo(200_000, 0);
  });

  it("stays null when no body radius resolves", () => {
    const get = getWith({ orbit: orbitPoint(ENTRY_ARC) });

    /*
     * The existing promise: never a body-less approximation. `verticalSpeed`
     * and `surfaceSpeed` stay null on this basis either way, being
     * surface-frame quantities the conic says nothing about.
     */
    const state = deriveVesselState(get, 0);
    expect(state?.altitudeAsl).toBeNull();
    expect(state?.verticalSpeed).toBeNull();
    expect(state?.surfaceSpeed).toBeNull();
  });

  it("names altitude among the paths the conic MOVES", () => {
    const get = getWith({
      orbit: orbitPoint(ENTRY_ARC),
      bodies: bodies({ atmosphere: true }),
    });

    /*
     * A plotted key needs its path named: the tail carries only what the model
     * claims, so an unnamed altitude would draw a chart that stops dead at the
     * last observation with nothing to say why.
     */
    const modelled = deriveVesselStateReckoning(get, 0);
    expect(modelled?.map((m) => m.path)).toContain("altitudeAsl");
  });
});

describe("deriveVesselStateReckoning: the producer's own stated reach", () => {
  it("refuses an arc whose elements state no horizon at all", () => {
    const { horizon: _dropped, ...noHorizon } = ENTRY_ARC;
    const get = getWith({
      orbit: orbitPoint(noHorizon as WireOf<VesselOrbitPayload>),
      bodies: bodies({ atmosphere: true }),
    });

    /*
     * `canPropagate`'s own argument, applied at the one propagation site in
     * the tree that was not asking it: "nobody said" must not read as "trust
     * this forever". `SystemView`, `usePhaseAngles` and the trajectory bridge
     * all gate on it and could, because they read the generated shape; this
     * function read a hand mirror with the field left out.
     */
    expect(deriveVesselStateReckoning(get, 0)).toBeUndefined();
  });

  it("refuses past an integrating provider's Until horizon", () => {
    const get = getWith({
      orbit: orbitPoint({
        ...ENTRY_ARC,
        horizon: { kind: 2, trajectoryKind: 2, untilUt: 500 },
      }),
      bodies: bodies({ atmosphere: true }),
    });

    /*
     * The case the seam was built for and nothing was consulting it in: an
     * n-body backend states a reach, and a conic drawn past it is faithful at
     * the sample instant and wrong as a path.
     */
    expect(deriveVesselStateReckoning(get, 400)).toBeDefined();
    expect(deriveVesselStateReckoning(get, 600)).toBeUndefined();
  });
});
