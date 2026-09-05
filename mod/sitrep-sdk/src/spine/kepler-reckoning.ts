import { Quality } from "../__generated__/contract";
import { magnitudeOr, type Quantityish } from "../magnitude";
import type { ReckoningDecline } from "../reading";
import type { TimelinePoint } from "../timeline";
import type {
  Anomalies,
  OrbitElements,
  PropagationHorizonLike,
  StateVector,
  Vector3,
} from "./kepler";
import { canPropagate, solve, solveAnomalies } from "./kepler";

/**
 * The conic, in ONE place, for both paths that reach it.
 *
 * `vessel.state` has forward-modelled its kinematics through
 * `deriveVesselStateReckoning` since long before a value could DECLARE itself
 * reckonable, and that implementation is the good one: it withdraws off rails,
 * at an SOI transition, past the producer's stated horizon and at the
 * atmosphere interface, and two committed render-fixture sets prove each
 * withdrawal. What it could not do is be reached the way a third-party author
 * reaches anything, because it is a derived channel's callback rather than a
 * registered model.
 *
 * So the guard and the arithmetic live here, and both callers are thin over
 * them: the derived channel asks {@link keplerAdmissibility} and answers with
 * its field list, and the registered reckoners in `core-reckoners.ts` ask the
 * same function and then solve. A second copy of these conditions is exactly
 * how a registered reckoner and a derived channel come to disagree about where
 * the conic ends, which is a disagreement no widget could report.
 */

/**
 * The slice of `vessel.orbit` a conic needs.
 *
 * Declared structurally rather than imported from `vessel-state.ts`, because
 * that module imports THIS one: the payload mirrors sit with the channel that
 * publishes them, and the propagator underneath must not depend on the record
 * built on top of it. Every field is the one `VesselOrbitPayload` already
 * carries, so a payload passes without a cast.
 */
export interface ConicOrbitInput {
  referenceBodyIndex: number;
  sma: Quantityish;
  ecc: Quantityish;
  inc: Quantityish;
  lan?: Quantityish | null;
  argPe?: Quantityish | null;
  meanAnomalyAtEpoch: Quantityish;
  epoch: Quantityish;
  mu: Quantityish;
  encounter?: { transitionUt: Quantityish } | null;
  horizon?: PropagationHorizonLike;
}

/** The slice of `system.bodies` a conic needs: enough to find the air. */
export interface ConicBodiesInput {
  bodies: readonly {
    index: number;
    radius?: Quantityish;
    atmosphere?: { depth?: Quantityish | null } | null;
  }[];
}

/**
 * Wire elements as `buildElements` reads them: every angle-bearing field as a
 * bare magnitude carrier, whatever wrapper the wire currently puts round it.
 */
export interface WireOrbitElements {
  sma: Quantityish;
  ecc: Quantityish;
  inc: Quantityish;
  lan?: Quantityish | null;
  argPe?: Quantityish | null;
  meanAnomalyAtEpoch: Quantityish;
  epoch: Quantityish;
  mu: Quantityish;
}

function mag(v: Quantityish): number {
  return magnitudeOr(v, Number.NaN);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Build the internal-radian `OrbitElements` (`kepler.ts`) from wire elements:
 * the ONE place the wire's degree/radian unit mix is normalized (inc/lan/argPe
 * degrees→radians; `meanAnomalyAtEpoch` already radians, the documented KSP
 * quirk) and a `null` `lan`/`argPe` (undefined node/apsis on a
 * near-equatorial/near-circular orbit) is substituted with 0, a
 * physically-arbitrary-but-harmless reference. Shared by the self-vessel
 * OnRails branch, the target-orbit derivation and every registered reckoner, so
 * all of them propagate through the identical conversion.
 */
export function buildElements(o: WireOrbitElements): OrbitElements {
  return {
    sma: mag(o.sma),
    ecc: mag(o.ecc),
    inc: degToRad(mag(o.inc)),
    lan: o.lan == null ? 0 : degToRad(mag(o.lan)),
    argPe: o.argPe == null ? 0 : degToRad(mag(o.argPe)),
    meanAnomalyAtEpoch: mag(o.meanAnomalyAtEpoch),
    epoch: mag(o.epoch),
    mu: mag(o.mu),
  };
}

/**
 * `kepler.solve`/`solveAnomalies` throw a `RangeError` for `ecc >= 1`,
 * elliptical-only, matching the C# side (see their own doc comments); that
 * throwing contract is intentional. A genuine hyperbolic OnRails trajectory (a
 * fast escape/flyby while time-warping) is real, though, so every caller here
 * checks explicitly rather than letting the throw escape into derived-channel
 * resolution or a reading build.
 */
export function isHyperbolic(ecc: number): boolean {
  return ecc >= 1;
}

/** Non-throwing `kepler.solve`: `null` on a hyperbolic orbit instead of a RangeError. */
export function trySolve(
  elements: OrbitElements,
  ut: number,
): StateVector | null {
  return isHyperbolic(elements.ecc) ? null : solve(elements, ut);
}

/** Non-throwing `kepler.solveAnomalies`: `null` on a hyperbolic orbit instead of a RangeError. */
export function trySolveAnomalies(
  elements: OrbitElements,
  ut: number,
): Anomalies | null {
  return isHyperbolic(elements.ecc) ? null : solveAnomalies(elements, ut);
}

/**
 * Dead-reckon a vessel's parent-relative position/velocity from its wire orbit
 * elements at `ut`, through the same `buildElements` + `trySolve` path the
 * active vessel uses. Returns null for a hyperbolic / unsolvable orbit rather
 * than throwing. No new math, just the shared propagator.
 */
export function propagateVesselOrbit(
  orbit: WireOrbitElements,
  ut: number,
): StateVector | null {
  return trySolve(buildElements(orbit), ut);
}

/**
 * The radius below which a vacuum two-body coast stops describing what happens:
 * the top of the atmosphere, or the surface on a body that has none.
 *
 * `kepler-propagation` states its own limits, and the third of them is "a
 * perturbation the propagator does not model". Drag is that perturbation, and
 * it is not a gentle one: a capsule crossing the interface at orbital speed
 * loses most of it inside a couple of minutes, so a conic carried past this
 * radius is not a degraded answer but a different trajectory. Below the surface
 * it is not a trajectory at all.
 *
 * One number covers both because the model is asking one question, and the
 * separate cases would only differ in a sentence nothing reads. `atmosphere`
 * absent means airless on this wire rather than unknown, which is what makes
 * the surface a sound floor rather than a guess.
 *
 * `undefined` when nothing here resolves, and the caller treats that as "no
 * evidence" rather than as a reason to decline: see
 * {@link keplerAdmissibility}.
 */
export function entryInterfaceRadius(
  bodies: ConicBodiesInput | undefined,
  index: number | null | undefined,
): number | undefined {
  if (index == null || !bodies) return undefined;
  const body = bodies.bodies.find((b) => b.index === index);
  if (!body) return undefined;
  /*
   * `magnitudeOr` rather than the raw field: `system.bodies` arrives unwrapped
   * today and wrapped the moment its type shape is registered, and a floor that
   * silently became NaN would stop declining without saying so.
   */
  const radius = magnitudeOr(body.radius, Number.NaN);
  if (!Number.isFinite(radius)) return undefined;
  const depth = magnitudeOr(body.atmosphere?.depth, 0);
  return radius + (Number.isFinite(depth) && depth > 0 ? depth : 0);
}

/**
 * Whether a two-body advance of these elements to `viewUt` is admissible, and
 * which published input says it is not.
 *
 * Four withdrawal conditions, in the order they cost least to ask:
 *
 * - **not on rails.** The elements describe a coast; a craft under physics is
 *   being pushed by something the conic does not model
 * - **the SOI transition.** A patched conic is only the CURRENT patch, so a
 *   view time at or past the transition is asking this conic about an orbit
 *   round a different body
 * - **the producer's own stated reach.** `orbit.horizon` is where an
 *   INTEGRATING propagation provider says its elements stop answering; the
 *   stock analytic provider says `Unbounded` and this never bites for it. It is
 *   also the seam a per-craft bound would arrive through, rather than anything
 *   here growing a constant of its own
 * - **the atmosphere interface.** A conic through air draws the same confident
 *   dashes a conic through vacuum draws, and the failure is worst exactly where
 *   an operator leans on it hardest
 *
 * **Declining takes positive evidence.** With no body roster there is no
 * interface to have crossed, so an absent `bodies` is not a reason to withdraw:
 * blanking every propagated reading for the frames before a once-a-second
 * channel lands would be a withdrawal asserted on the LACK of a fact. Same
 * posture the SOI condition takes on an absent `encounter`.
 *
 * What is still unbounded, and cannot be bounded here: a BURN. A craft out of
 * contact is exactly one whose burns we cannot see, so nothing inside this
 * function can bound it, and the `kepler-propagation` basis carries that caveat
 * in its own words. That is what a basis is for.
 */
export function keplerAdmissibility(
  orbitPoint: TimelinePoint<ConicOrbitInput> | undefined,
  bodies: ConicBodiesInput | undefined,
  viewUt: number,
): { readonly ok: true } | { readonly declined: ReckoningDecline } {
  if (orbitPoint?.payload == null) {
    return {
      declined: { reason: "input-absent", input: "@vessel.orbit" },
    };
  }
  if (orbitPoint.meta.quality !== Quality.OnRails) {
    return {
      declined: {
        reason: "model-inapplicable",
        input: "@vessel.orbit",
        note: "the craft is under physics, so its elements are not a coast a conic can advance",
      },
    };
  }
  const orbit = orbitPoint.payload;
  const transitionUt = orbit.encounter?.transitionUt;
  if (transitionUt != null) {
    const at = mag(transitionUt);
    if (Number.isFinite(at) && viewUt >= at) {
      return {
        declined: {
          reason: "beyond-horizon",
          input: "@vessel.orbit",
          note: "this patch ends at the SOI transition",
        },
      };
    }
  }
  if (!canPropagate(orbit.horizon, viewUt, viewUt).propagatable) {
    return {
      declined: {
        reason: "beyond-horizon",
        input: "@vessel.orbit",
        note: "past the reach the propagation provider states for these elements",
      },
    };
  }
  const floor = entryInterfaceRadius(bodies, orbit.referenceBodyIndex);
  if (floor !== undefined) {
    const solved = trySolve(buildElements(orbit), viewUt);
    const radius = solved == null ? Number.NaN : magnitude(solved.position);
    if (Number.isFinite(radius) && radius <= floor) {
      return {
        declined: {
          reason: "beyond-horizon",
          input: "@system.bodies",
          note: "below the atmosphere interface, where drag the conic does not model takes over",
        },
      };
    }
  }
  return { ok: true };
}

/** The length of a bare three-component vector. */
export function magnitude(v: Vector3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * A position advanced by a constant velocity: the whole of
 * `linear-dead-reckoning`, and it is one multiply-add per axis on purpose.
 *
 * Shared by the two relative-geometry reckoners rather than written twice, and
 * there is deliberately nothing from the conic in it: a relative pair has no
 * elements, no epoch and no mu, so pretending the two models have machinery in
 * common would be a shared abstraction over two things that are not alike.
 */
export function advanceByVelocity(
  position: readonly [number, number, number],
  velocity: readonly [number, number, number],
  dt: number,
): [number, number, number] {
  return [
    position[0] + velocity[0] * dt,
    position[1] + velocity[1] * dt,
    position[2] + velocity[2] * dt,
  ];
}
