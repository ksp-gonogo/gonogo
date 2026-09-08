import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import { makeMeta } from "../testing/stub-transport";
import type { TimelinePoint } from "../timeline";
import { value } from "../unit-system/value";
import {
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
} from "./kepler";
import { type ConicOrbitInput, keplerAdmissibility } from "./kepler-reckoning";

/**
 * Who owns the trajectory, asked before a conic is advanced.
 *
 * The four conditions `keplerAdmissibility` shipped with all ask where the
 * elements stop describing the craft: off rails, past the patch, past the
 * producer's reach, into the air. None of them asks whether a two-body advance
 * describes it in the FIRST place, which under an n-body backend it does not:
 * whichever provider wins the `propagation` capability stamps every element set
 * it publishes with what KIND of answer it is, and an integrating one publishes
 * an osculating snapshot rather than a path. Advancing one is not a degraded
 * conic, it is a different physics.
 *
 * Which backend won is deliberately not named here, or asked anywhere below.
 * `PropagationElection`'s own doc makes that a rule rather than a courtesy, and
 * `uplink-boundary.test.ts` enforces it: a client that knows a vendor's name is
 * a client that will eventually branch on it.
 *
 * The answer was already on the wire. `PropagationElection.HorizonFor` states
 * both halves of the horizon, and `UNBOUNDED_HORIZON`'s own fixture doc already
 * wrote down the rule these pin: a consumer "deciding whether a conic is the
 * right renderer must read [Unspecified] as 'unknown' rather than 'conic'".
 *
 * The gate asks only about an UNBOUNDED reach, and the last two cases below are
 * why. An `Until` bound is a MEASUREMENT taken from the integrating provider
 * itself (`IntegratedHorizon.UntilUt` bisects its `CanPropagate`), so inside one
 * the provider has vouched for a two-body extrapolation per craft and the reach
 * gate enforces it. What nobody vouches for is a conic carried forever on
 * elements whose shape nothing stated.
 */

const KERBIN_MU = 3.5316e12;

/** A circular 200 km Kerbin orbit: on rails, well clear of the air, no encounter. */
function orbitPoint(
  horizon: ConicOrbitInput["horizon"],
  quality: Quality = Quality.OnRails,
): TimelinePoint<ConicOrbitInput> {
  return {
    validAt: 0,
    epoch: 0,
    meta: makeMeta({ validAt: 0, deliveredAt: 0, quality }),
    payload: {
      referenceBodyIndex: 1,
      sma: value("m", 800_000),
      ecc: value("1", 0),
      inc: value("°", 0),
      lan: value("°", 0),
      argPe: value("°", 0),
      meanAnomalyAtEpoch: value("rad", 0),
      epoch: value("ut", 0),
      mu: value("m³/s²", KERBIN_MU),
      horizon,
    },
  };
}

const BODIES = {
  bodies: [
    { index: 1, radius: value("m", 600_000), atmosphere: { depth: null } },
  ],
};

describe("keplerAdmissibility asks who owns the trajectory", () => {
  it("advances the conic when the elected provider is analytic", () => {
    /*
     * The vanilla, and the answer for an unmodified game: `KeplerProvider` is the
     * capability's always-present factory and stock KSP physics IS two-body, so
     * this is correct rather than merely permitted.
     */
    expect(
      keplerAdmissibility(
        orbitPoint({ kind: Reach.Unbounded, trajectoryKind: Shape.Analytic }),
        BODIES,
        300,
      ),
    ).toEqual({ ok: true });
  });

  it("DECLINES an integrated element set that bounded nothing", () => {
    // Everything the four original conditions ask is satisfied: on rails, no
    // encounter, an unbounded reach, and far above the interface. Only the
    // authority rules it out, so nothing but the new gate can produce this.
    // `IIntegratedTrajectorySource`'s own doc names this pair: an integrating
    // provider in a low-perturbation regime can honestly report no limit.
    const admissible = keplerAdmissibility(
      orbitPoint({ kind: Reach.Unbounded, trajectoryKind: Shape.Integrated }),
      BODIES,
      300,
    );

    expect(admissible).toEqual({
      declined: {
        reason: "model-inapplicable",
        input: "@vessel.orbit#horizon",
        note: "the provider integrates these elements and bounded nothing, so there is no window in which they are a conic to advance",
      },
    });
  });

  it("declines an UNBOUNDED reach whose shape nobody stated", () => {
    // The reach gate PERMITS this window: `canPropagate` reads `Unbounded` and
    // says yes, and deliberately never consults the shape. So an unstated shape
    // reaches a conic with nothing to stop it, which is the permissive default
    // `TrajectoryKind.Unspecified = 0` exists to remove.
    const admissible = keplerAdmissibility(
      orbitPoint({ kind: Reach.Unbounded, trajectoryKind: Shape.Unspecified }),
      BODIES,
      300,
    );

    expect(admissible).toEqual({
      declined: {
        reason: "model-inapplicable",
        input: "@vessel.orbit#horizon",
        note: "no provider stated what kind of answer these elements are, so nothing vouches for carrying them forever as a conic",
      },
    });
  });

  it("declines an ABSENT shape the same way it declines an unstated one", () => {
    // A horizon carrying reach alone is what a producer predating the field
    // sends, and `UNBOUNDED_HORIZON`'s fixture doc names that case exactly.
    // Absent and Unspecified are one answer here: nobody said.
    expect(
      keplerAdmissibility(orbitPoint({ kind: Reach.Unbounded }), BODIES, 300),
    ).toMatchObject({
      declined: {
        reason: "model-inapplicable",
        input: "@vessel.orbit#horizon",
      },
    });
  });

  it("names the authority ahead of a craft that is also under physics", () => {
    // Both conditions bite. The authority answers first because it is the
    // permanent fact: being under physics passes when the craft goes back on
    // rails, and an n-body save never becomes two-body.
    expect(
      keplerAdmissibility(
        orbitPoint(
          { kind: Reach.Unbounded, trajectoryKind: Shape.Integrated },
          Quality.Loaded,
        ),
        BODIES,
        300,
      ),
    ).toMatchObject({
      declined: { input: "@vessel.orbit#horizon" },
    });
  });

  it("ADVANCES an integrated set inside a reach the provider measured", () => {
    // The case `IntegratedHorizon` exists to serve, and the one the gate must
    // not swallow. Its subject is "how far a two-body extrapolation of an
    // INTEGRATED trajectory stays trustworthy", recovered per craft by bisecting
    // the provider's own `CanPropagate`. Declining here would throw that
    // measurement away and leave the whole search answering nobody.
    expect(
      keplerAdmissibility(
        orbitPoint({
          kind: Reach.Until,
          untilUt: 500,
          trajectoryKind: Shape.Integrated,
        }),
        BODIES,
        400,
      ),
    ).toEqual({ ok: true });
  });

  it("still refuses that same set past the reach the provider measured", () => {
    // The reach gate, unchanged and still the one doing this work.
    expect(
      keplerAdmissibility(
        orbitPoint({
          kind: Reach.Until,
          untilUt: 500,
          trajectoryKind: Shape.Integrated,
        }),
        BODIES,
        600,
      ),
    ).toMatchObject({ declined: { reason: "beyond-horizon" } });
  });

  it("still reports an absent input ahead of the authority", () => {
    // Nothing arrived, so there is no horizon to have an opinion about. The
    // contract's own word for the promise that was not kept beats a sentence
    // about a provider nobody heard from.
    expect(keplerAdmissibility(undefined, BODIES, 300)).toEqual({
      declined: { reason: "input-absent", input: "@vessel.orbit" },
    });
  });
});
