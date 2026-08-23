/**
 * `@ksp-gonogo/sitrep-sdk/frames`: the reference-frame arithmetic, as an author
 * surface.
 *
 * An Uplink that contributes a projection needs to say where a point IS in the
 * frame it chose: a frame choice, that choice resolved to a state at one
 * instant, the forward and inverse position transforms, and the fact that a
 * pulsating frame's coordinates are ratios rather than distances. That is the
 * whole of what is below.
 *
 * ## Why this is not the root barrel
 *
 * The root barrel already exports the unit system's `Vector3`, an `{x, y, z}`
 * of unit-carrying `Value`s, and the arithmetic here takes the Keplerian one, a
 * bare `readonly [x, y, z]` of numbers. Two exports of one name resolve
 * silently in favour of the one already there, so putting the arithmetic on the
 * root barrel does not fail at the barrel: it fails at the author's own call
 * site with `Type 'Vector3<string>' is not assignable to parameter of type
 * 'Vector3'`, pointing at their code about a collision they did not make.
 *
 * **On this subpath `Vector3` is the Keplerian tuple and nothing else.** An
 * author holding the unit-carrying one, which is what every position and
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
 * Deliberately absent, each because it is a choice we intend to keep making:
 *
 * - `pointMassAccelerationAt`, a gravity sum whose stated fidelity (point
 *   masses, no field terms) is a judgement we may revisit
 * - `frameSides` and `FrameSides`, which replicate the in-game frame selector's
 *   own notion of which bodies sit on each side, and so track something outside
 *   this repo
 * - the libration-point arithmetic, a second domain vocabulary of eleven names
 *   including two tunable station-keeping thresholds. First-party code reaches
 *   it through `/spine`; publishing it needs its own decision and a consumer
 *   asking for it
 * - `CelestialFacts` and `CelestialBody`, the catalogue every function below
 *   takes. Already on the root barrel, which is where the catalogue is produced,
 *   and a type reachable through two paths raises a canonicality question for no
 *   capability gained
 */

import type { Vector3 } from "../spine/kepler";
import type { Vec3Of } from "../value";

export {
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

/**
 * A bare `[x, y, z]`. The only `Vector3` this subpath makes reachable, and the
 * shape every function above takes and returns.
 */
export type { Vector3 };

/**
 * A unit-carrying wire vector as the bare triple the arithmetic takes.
 *
 * Constrained to metres and metres per second, which is what the arithmetic is
 * in throughout. That constraint is why this exists rather than the conversion
 * being written at each call site: a dimensionless `Vec3Of<"1">` (an
 * orientation, say) reads as a position perfectly well once its components are
 * loose numbers, and hand-extraction in this repo was previously written as a
 * cast, which put `Value` objects through arithmetic that wanted numbers.
 *
 * Position and velocity share one door because splitting them would buy
 * nothing: both would return the same tuple type, so neither spelling can stop
 * the two being handed to `toFrame` in the wrong order.
 */
export function frameVector<U extends "m" | "m/s">(v: Vec3Of<U>): Vector3 {
  return [v.x.magnitude, v.y.magnitude, v.z.magnitude];
}
