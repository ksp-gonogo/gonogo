import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import { makeMeta } from "../testing/stub-transport";
import type { TimelinePoint } from "../timeline";
import { value } from "../unit-system/value";
import {
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
} from "./kepler";
import {
  type ConicBodiesInput,
  type ConicOrbitInput,
  keplerAdmissibility,
} from "./kepler-reckoning";

/**
 * Where the conic stops being a description of what happens, along an ARC.
 *
 * `kepler-withdrawal-reasons.test.ts` names the reason each withdrawal carries
 * off a craft that is already wherever it is. These cases carry one set of
 * elements along its own path and ask at which instants the conic may still be
 * advanced: into the air, onto the ground, and past the reach the producer
 * stated. The horizon is a fact off the wire, not a constant, and the model
 * withdraws by declining rather than by degrading.
 */

const KERBIN_RADIUS = 600_000;
const KERBIN_ATMOSPHERE_DEPTH = 70_000;
const MU_KERBIN = 3.5316e12;
const ANALYTIC = { kind: Reach.Unbounded, trajectoryKind: Shape.Analytic };

/**
 * Apoapsis 800 km from the centre, periapsis 630 km: 200 km of altitude at the
 * top and 30 km at the bottom, so the arc passes through Kerbin's 70 km
 * interface on the way down and is well clear of the surface at every instant.
 * An atmospheric horizon and a surface-impact horizon have to be
 * distinguishable, and this orbit crosses exactly one.
 *
 * `meanAnomalyAtEpoch: PI` starts it at apoapsis, so UT 0 is the honest end of
 * the arc and half a period later is the dishonest one.
 */
const ENTRY_ARC: ConicOrbitInput = {
  referenceBodyIndex: 1,
  sma: value("m", 715_000),
  ecc: value("1", 170_000 / 1_430_000),
  inc: value("°", 0),
  lan: value("°", 0),
  argPe: value("°", 0),
  meanAnomalyAtEpoch: value("rad", Math.PI),
  epoch: value("ut", 0),
  mu: value("m³/s²", MU_KERBIN),
  horizon: ANALYTIC,
};

/** Periapsis 500 km, which is 100 km INSIDE Kerbin. The conic aims at rock. */
const IMPACT_ARC: ConicOrbitInput = {
  ...ENTRY_ARC,
  sma: value("m", 650_000),
  ecc: value("1", 150_000 / 1_300_000),
};

/** Half the period of `ENTRY_ARC`: the instant it reaches periapsis. */
const PERIAPSIS_UT = Math.PI * Math.sqrt(715_000 ** 3 / MU_KERBIN);

/** Half the period of `IMPACT_ARC`: the instant its conic is deepest in rock. */
const IMPACT_SIDE_UT = Math.PI * Math.sqrt(650_000 ** 3 / MU_KERBIN);

function orbitPoint(orbit: ConicOrbitInput): TimelinePoint<ConicOrbitInput> {
  return {
    validAt: 0,
    epoch: 0,
    meta: makeMeta({ validAt: 0, deliveredAt: 0, quality: Quality.OnRails }),
    payload: orbit,
  };
}

/** `atmosphere` omitted is the wire's own way of saying the body is airless. */
function kerbin(opts: { atmosphere: boolean }): ConicBodiesInput {
  return {
    bodies: [
      {
        index: 1,
        radius: value("m", KERBIN_RADIUS),
        ...(opts.atmosphere
          ? { atmosphere: { depth: value("m", KERBIN_ATMOSPHERE_DEPTH) } }
          : {}),
      },
    ],
  };
}

function admits(
  orbit: ConicOrbitInput,
  bodies: ConicBodiesInput | undefined,
  viewUt: number,
): boolean {
  return "ok" in keplerAdmissibility(orbitPoint(orbit), bodies, viewUt);
}

describe("keplerAdmissibility along an arc: the atmospheric interface", () => {
  it("admits the arc while it is above the interface", () => {
    // UT 0 is apoapsis, 200 km up: nothing but vacuum between here and there.
    expect(admits(ENTRY_ARC, kerbin({ atmosphere: true }), 0)).toBe(true);
  });

  it("declines once the arc has carried the craft into the air", () => {
    // Periapsis is 30 km up, 40 km inside the interface. A conic has no drag
    // term, so what it draws here is not what happens here.
    expect(
      keplerAdmissibility(
        orbitPoint(ENTRY_ARC),
        kerbin({ atmosphere: true }),
        PERIAPSIS_UT,
      ),
    ).toMatchObject({
      declined: { reason: "beyond-horizon", input: "@system.bodies" },
    });
  });

  it("keeps admitting the same arc around an AIRLESS body", () => {
    // One field apart from the case above, and the opposite answer: with no air a 30 km periapsis is just a low periapsis, and the conic is right.
    expect(admits(ENTRY_ARC, kerbin({ atmosphere: false }), PERIAPSIS_UT)).toBe(
      true,
    );
  });

  it("declines on an arc that reaches the SURFACE of an airless body", () => {
    // The floor is the ground when there is no air above it. A coast that
    // continues below the surface is a claim about a crater.
    expect(admits(IMPACT_ARC, kerbin({ atmosphere: false }), 0)).toBe(true);
    expect(
      admits(IMPACT_ARC, kerbin({ atmosphere: false }), IMPACT_SIDE_UT),
    ).toBe(false);
  });

  it("admits the arc unchanged when the body table has not arrived", () => {
    /*
     * Declining takes positive evidence. With no roster there is no interface
     * to have crossed, and refusing on an absent fact would blank every
     * propagated reading for the frames before the roster lands.
     */
    expect(admits(ENTRY_ARC, undefined, PERIAPSIS_UT)).toBe(true);
  });

  it("admits the arc unchanged when the body carries no radius yet", () => {
    expect(
      admits(ENTRY_ARC, { bodies: [{ index: 1, radius: null }] }, PERIAPSIS_UT),
    ).toBe(true);
  });
});

describe("keplerAdmissibility along an arc: the producer's own stated reach", () => {
  it("refuses elements that state no horizon at all", () => {
    const { horizon: _dropped, ...noHorizon } = ENTRY_ARC;

    // "Nobody said" must not read as "trust this forever".
    expect(admits(noHorizon, kerbin({ atmosphere: true }), 0)).toBe(false);
  });

  it("admits up to a stated Until horizon and refuses past it", () => {
    const bounded: ConicOrbitInput = {
      ...ENTRY_ARC,
      horizon: {
        kind: Reach.Until,
        untilUt: 500,
        trajectoryKind: Shape.Analytic,
      },
    };

    // A backend that states a reach is faithful at the sample instant and wrong as a path once the view runs past it.
    expect(admits(bounded, kerbin({ atmosphere: true }), 400)).toBe(true);
    expect(admits(bounded, kerbin({ atmosphere: true }), 600)).toBe(false);
  });
});
