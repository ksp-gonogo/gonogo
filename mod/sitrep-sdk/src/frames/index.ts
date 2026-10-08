/**
 * `@ksp-gonogo/sitrep-sdk/frames`: the reference-frame arithmetic, as an author
 * surface.
 *
 * An Uplink that contributes a projection needs to say where a point IS in the
 * frame it chose: a frame choice, that choice resolved to a state at one
 * instant, the forward and inverse position transforms, and the fact that a
 * pulsating frame's coordinates are ratios rather than distances.
 *
 * Three things built on those transforms are here too, because an author drawing
 * in a frame needs them beside it:
 *
 * - a craft's path in the frame you chose, from `useOrbitTrajectory`, with
 *   `trajectoryFrameLabel` to name the frame beside it
 * - the two conic steps an author turning an orbit's elements into a drawn
 *   point needs, `trueAnomalyFromEccentric` and `rotatePerifocalToInertial`
 * - a body pair's five libration points, which stand still only in that pair's
 *   rotating-pulsating frame, and a craft's offset from the nearest one
 *
 * ## Two vector types, two names
 *
 * The root barrel exports the unit system's `Vector3`, an `{x, y, z}` of
 * unit-carrying `Value`s. The arithmetic here takes a bare
 * `readonly [x, y, z]` of numbers, named `Vec3Tuple` so the two never share a
 * name and a call site never meets `Type 'Vector3<string>' is not assignable to
 * parameter of type 'Vector3'`.
 *
 * An author holding the unit-carrying one, which is what every position and
 * velocity field on the wire carries, converts it with {@link frameVector}.
 *
 * ## Why this is not `/spine`
 *
 * `/spine` is where the arithmetic is implemented, alongside the read semantics
 * of a topic and the timeline store, and its own header says it is deliberately
 * not an author surface: publishing it would freeze the evolving internals of
 * the whole client half as third-party API. It resolves at runtime because
 * first-party code needs it to, and that is not permission. This subpath is the
 * permission, and it is narrow on purpose.
 *
 * Re-exports rather than a move, so a `FrameInstant` reached through either
 * path is the same declaration. A second copy of the type is the failure this
 * shape exists to make impossible.
 *
 * ## A curated list rather than a wildcard
 *
 * `/spine` uses wildcards because a private barrel's job is to be complete, and
 * a curated list there silently omitted six names. A published surface has the
 * opposite job: everything on it is a promise, so a wildcard would put the next
 * export added to `reference-frame.ts` in front of third-party authors without
 * anyone deciding to. The omission a wildcard guards against is covered instead
 * by `frames.test-d.ts` beside this file, which names every export below and so
 * fails to compile if one is renamed away. That is the only check that can see a
 * name here: the link probe in
 * `packages/app/src/uplinks/externals/runtimeLink.test.ts` marks the sdk
 * external, so esbuild never resolves the module and a rename leaves it green.
 * Measured, by renaming `frameVector`: the link probe passed all six of its
 * tests and `tsc` reported two diagnostics.
 *
 * `systemInstantAt` and `SystemInstant` are on the list for a reason that is
 * not obvious: a widget placing bodies AND a craft in the same frame needs
 * every body's state at the view instant anyway, and passing that state into
 * `frameInstantAt` is what stops the catalogue being solved twice per placement.
 *
 * ## What `systemInstantAt` gives you, and what changes under n-body physics
 *
 * It is the one function here that makes a claim rather than restating one: it
 * evaluates the catalogue's elements at whatever UT you name. Which install the
 * operator is running changes the answer, and your widget sees the difference
 * WITHOUT branching on a mod name. There is no mod name to branch on here and
 * that is deliberate: the horizon is a standard shape every provider fills, and
 * a vendor's name has no place in one.
 *
 * - **Stock.** Every body rides a fixed conic about a fixed parent, so its place
 *   at any UT is a published fact. Ask for an instant and you get every body,
 *   however far out you ask. `withdrawnByIndex` is empty, always. There is no
 *   propagation to wait for and nothing advances per frame: call it for the
 *   instant you are drawing.
 * - **An n-body install.** A body's elements are the conic tangent to an
 *   integrated path at the sample instant, and the elected provider states how
 *   far they stay worth having. Past that a body is NOT in `positionByIndex`,
 *   and `withdrawnByIndex` names which body's horizon ran out and when. A moon
 *   whose own elements are unbounded is withdrawn too when its planet's ran
 *   out, naming the planet.
 *
 * **So a body absent from `positionByIndex` is not always a gap in the
 * catalogue.** Check `withdrawnByIndex` before drawing "no data": a withdrawal
 * is an answer, and the honest thing to draw is the body's absence past a stated
 * instant, not a body placed where nobody vouched for it. Widening the window a
 * caller asks for is what shortens the set of bodies that come back.
 *
 * `body.horizon` on the catalogue carries the same statement per body, in the
 * same words a craft's `vessel.orbit` horizon uses: `kind`, `trajectoryKind`,
 * and a `untilUt` that is an absolute UT rather than a duration. Its
 * `trajectoryKind` is the separate question of SHAPE, and it is the one to
 * branch on before drawing a closed ellipse for a body.
 *
 * Deliberately absent, each because it is a choice we intend to keep making:
 *
 * - `pointMassAccelerationAt`, a gravity sum whose stated fidelity (point
 *   masses, no field terms) is a judgement we may revisit
 * - `frameSides` and `FrameSides`, which replicate the in-game frame selector's
 *   own notion of which bodies sit on each side, and so track something outside
 *   this repo
 * - the two station-keeping thresholds behind `LibrationStationKeeping`, which
 *   are tuning rather than physics: read the meaning, not the distance it was
 *   cut at
 * - `CelestialFacts` and `CelestialBody`, the catalogue every function below
 *   takes. Already on the root barrel, which is where the catalogue is produced,
 *   and a type reachable through two paths raises a canonicality question for no
 *   capability gained
 */

import type { Vec3Tuple } from "../spine/kepler";
import type { Vec3Of } from "../value";

export {
  CONTROL_FRAME_TOPIC,
  controlFrameToReadFrameChoice,
  readFrameChoicesEqual,
} from "../spine/control-frame-to-read-frame";
export {
  rotatePerifocalToInertial,
  trueAnomalyFromEccentric,
} from "../spine/kepler";
export {
  type LagrangePointName,
  LIBRATION_REFUSALS,
  type LibrationAnswer,
  type LibrationOffset,
  type LibrationPair,
  type LibrationPoint,
  type LibrationRefusal,
  type LibrationStationKeeping,
  lagrangePointsAt,
  librationOffsetOf,
  librationPairLabel,
  librationPairsOf,
} from "../spine/lagrange";
export {
  type OrbitTrajectory,
  type TrajectoryFrame,
  TrajectoryFrameKindLike,
  trajectoryFrameLabel,
} from "../spine/orbit-trajectory";
export {
  type BodyWithdrawal,
  type FrameCoordinates,
  type FrameInstant,
  frameInstantAt,
  fromFrame,
  READ_FRAME_KINDS,
  type ReadFrameChoice,
  type ReadFrameKind,
  resolveReadFrame,
  type SystemInstant,
  systemInstantAt,
  TRAJECTORY_SCALE_CONVENTIONS,
  type TrajectoryScaleConvention,
  toFrame,
} from "../spine/reference-frame";
export { useOrbitTrajectory } from "../spine/use-orbit-trajectory";

/**
 * A bare `[x, y, z]` of numbers, the shape every function above takes and
 * returns. Not the root barrel's `Vector3`, the `{x, y, z}` of unit-carrying
 * `Value`s.
 */
export type { Vec3Tuple };

/**
 * Returns a position or velocity from a payload, a {@link Vec3Of} in metres
 * or metres per second, as the plain `[x, y, z]` numbers the frame functions
 * on this subpath take, such as {@link toFrame}.
 *
 * @category Frames of reference
 */
export function frameVector<Unit extends "m" | "m/s">(
  v: Vec3Of<Unit>,
): Vec3Tuple {
  return [v.x.magnitude, v.y.magnitude, v.z.magnitude];
}
