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
import {
  canPropagate,
  PropagationHorizonKindLike,
  solve,
  solveAnomalies,
  TrajectoryKindLike,
} from "./kepler";

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
  return radius + (atmosphereDepthOf(bodies, index) ?? 0);
}

/**
 * How deep the parent body's air is, or `undefined` when there is none and when
 * there is no evidence either way.
 *
 * The published depth, minted ONCE, because it is the boundary BOTH forward
 * models of an altitude are drawn against and a second reading of the same field
 * is how they would come to disagree about where the vacuum ends.
 * {@link entryInterfaceRadius} adds it to the body radius, because a conic works
 * in radii; `atmosphericAdmissibility` compares it against the observed
 * `altitudeAsl`, because a rate integration works in altitude ASL. Those are the
 * same line, since `altitudeAsl` is `radius - seaLevel` by definition, so the
 * two models hand over at one instant rather than overlapping or leaving a gap.
 *
 * `undefined` for an airless body rather than zero, and that is what makes the
 * atmospheric branch decline to claim one: there is no atmospheric regime
 * without air, where a floor at the bare surface would have read as one. An
 * absent roster answers `undefined` for the same reason it does above, which the
 * two callers then treat oppositely and both correctly: the conic has no
 * interface to have crossed and carries on, and the rate integration has no
 * evidence it is in air and stands down.
 */
export function atmosphereDepthOf(
  bodies: ConicBodiesInput | undefined,
  index: number | null | undefined,
): number | undefined {
  if (index == null || !bodies) return undefined;
  const body = bodies.bodies.find((b) => b.index === index);
  const depth = magnitudeOr(body?.atmosphere?.depth, 0);
  return depth > 0 ? depth : undefined;
}

/**
 * Whether an UNBOUNDED reach is one a conic may be carried across, or the
 * refusal that says nobody vouched for it.
 *
 * The question is a CAPABILITY's, not a mod's. `PropagationElection` runs one
 * exclusive `propagation` capability whose vanilla factory is the two-body
 * solver, because stock KSP physics genuinely is two-body; an n-body backend
 * registers a higher-priority provider only when its own probe finds the
 * physics loaded, and `HorizonFor` then stamps every element set that provider
 * publishes with `TrajectoryKind.Integrated`. So the answer a reckoner needs is
 * already on the wire, on a field that names no vendor and that every provider
 * can state, stock included. That is also why this reads the horizon rather
 * than a planner or a provider id: `VesselManeuver.Planner`'s doc forbids a
 * consumer special-casing an elected implementation by name, and
 * `TrajectoryKind` exists precisely because an earlier draft of this field
 * carried the provider's id and answered "who computed this" where a client
 * needed "what is this like".
 *
 * **Only `Unbounded` is asked about, and the narrowness is the whole design.**
 * An `Until` bound is not a producer admitting a limit, it is a MEASUREMENT:
 * `IntegratedHorizon.UntilUt` recovers it by bisecting the integrating
 * provider's own `CanPropagate`, and its subject is "how far a two-body
 * extrapolation of an integrated trajectory stays trustworthy". A provider that
 * publishes one has vouched for a conic across exactly that window, per craft,
 * and the reach gate below already enforces it. Declining there would discard
 * the measurement and leave that machinery answering nobody. `Unspecified`
 * reach is already refused by the same gate. So the one case left over is an
 * unbounded reach with nothing vouching for its shape, which is the failure
 * `IIntegratedTrajectorySource`'s own doc names: an integrating provider in a
 * low-perturbation regime can honestly report no limit, and a client reasoning
 * "unbounded, therefore analytic, therefore an ellipse is fine" draws a path
 * the craft will not fly.
 *
 * `null` when a conic is vouched for. An absent `horizon` is left alone: the
 * reach gate owns that case and refuses it in its own words.
 */
function trajectoryAuthority(
  horizon: PropagationHorizonLike | undefined,
): ReckoningDecline | null {
  if (horizon == null) return null;
  if (horizon.kind !== PropagationHorizonKindLike.Unbounded) return null;
  if (horizon.trajectoryKind === TrajectoryKindLike.Analytic) return null;
  if (horizon.trajectoryKind === TrajectoryKindLike.Integrated) {
    return {
      reason: "model-inapplicable",
      input: "@vessel.orbit#horizon",
      note: "the provider integrates these elements and bounded nothing, so there is no window in which they are a conic to advance",
    };
  }
  return {
    reason: "model-inapplicable",
    input: "@vessel.orbit#horizon",
    note: "no provider stated what kind of answer these elements are, so nothing vouches for carrying them forever as a conic",
  };
}

/**
 * Whether a two-body advance of these elements to `viewUt` is admissible, and
 * which published input says it is not.
 *
 * Five withdrawal conditions, in the order they cost least to ask:
 *
 * - **who owns the trajectory, where nothing bounds it.** The elected
 *   propagation provider states, on every element set it publishes, what KIND
 *   of answer it is. An `Unbounded` reach paired with a shape that is not
 *   `Analytic` is a licence to carry an integrated path forever as an ellipse,
 *   which is not a degraded conic but a different physics
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
 * **The authority condition is the exception, and deliberately.** Under an
 * unbounded reach an unstated shape is not a missing fact to be generous about,
 * it is the permissive default `TrajectoryKind.Unspecified = 0` was numbered to
 * remove: a producer that forgets gets the withholding answer rather than
 * "conic, obviously". The fixtures wrote this rule down before anything
 * enforced it, in `UNBOUNDED_HORIZON`'s own doc: a consumer deciding whether a
 * conic is the right renderer "must read that as 'unknown' rather than
 * 'conic'".
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
  const authority = trajectoryAuthority(orbitPoint.payload.horizon);
  if (authority !== null) return { declined: authority };
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
