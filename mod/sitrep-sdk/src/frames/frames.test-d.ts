/**
 * The `/frames` published surface, and the `Vector3` collision it exists to
 * avoid.
 *
 * ## The collision, measured rather than reasoned about
 *
 * Two types in this package are called `Vector3`. The unit system's is an
 * `{x, y, z}` of unit-carrying `Value`s, the shape that comes off the wire, and
 * the root barrel exports it. The Keplerian one is a bare `readonly [x, y, z]`
 * of numbers, and it is what the frame arithmetic takes and returns.
 *
 * Putting the arithmetic on the ROOT barrel does not fail at the barrel: two
 * exports of one name resolve silently in favour of the one already there, so
 * `tsc` reports nothing about the package. Star-exporting `spine/kepler` and
 * `spine/reference-frame` from `index.ts` and compiling an author's
 * `toFrame(instant, v)` where `v: Vector3` produced exactly one diagnostic, in
 * the author's own file: `TS2345: Argument of type 'Vector3<string>' is not
 * assignable to parameter of type 'Vector3'`. A message about a collision they
 * did not make, in a file they own, naming one type twice.
 *
 * So the arithmetic is on `/frames`, where only one `Vector3` is reachable, and
 * the assertions below hold both barrels at once because that is the situation
 * it has to be absent in.
 *
 * ## It is also the pin on the surface's shape
 *
 * Every `/frames` export is named in the import, and this is the only check in
 * the tree that can see one. The link probe in
 * `packages/app/src/uplinks/externals/runtimeLink.test.ts` marks the sdk
 * external, so esbuild never resolves the module: renaming `frameVector` left
 * all six of its tests green and produced two diagnostics here. Keeping the list
 * complete is what makes the barrel's curated export list safe to prefer over a
 * wildcard.
 *
 * Written from the specifiers an Uplink author writes rather than relative
 * paths, which buys one more thing: this is the only check that compiles the
 * `./frames` entry in `exports`, because the link probe externalises the sdk
 * instead of resolving it.
 *
 * Nothing here runs. `tsc -p tsconfig.test-d.json` compiling it IS the
 * assertion; vitest goes through esbuild, which strips types and would happily
 * link a call that does not typecheck.
 */

import { type Vec3Of, type Vector3, value } from "@ksp-gonogo/sitrep-sdk";
import {
  type FrameCoordinates,
  type FrameInstant,
  type Vector3 as FrameVector3,
  frameInstantAt,
  frameVector,
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
} from "@ksp-gonogo/sitrep-sdk/frames";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;

/**
 * The two are genuinely different types, which is the whole reason one barrel
 * cannot carry both. If this stops holding, someone has unified the shapes and
 * this file has stopped describing reality.
 */
export type _TheyAreDifferent = Expect<Not<Equal<Vector3, FrameVector3>>>;

/** `/frames` reaches the Keplerian tuple, and it is a tuple. */
export type _FramesVectorIsTheTuple = Expect<
  Equal<FrameVector3, readonly [x: number, y: number, z: number]>
>;

/**
 * The whole round trip an author writes: choose a frame, resolve it at an
 * instant, put a point into it, and get the point back out in metres. Bare
 * triples straight into the arithmetic, with the root barrel imported in the
 * same file.
 */
export function _transformsAPoint(
  facts: Parameters<typeof systemInstantAt>[0],
  chosen: ReadFrameChoice,
  controlFrame: ReadFrameChoice | null,
  ut: number,
): FrameVector3 | null {
  const choice = resolveReadFrame(chosen, controlFrame);
  if (choice === null) return null;
  const system: SystemInstant = systemInstantAt(facts, ut);
  const instant: FrameInstant | null = frameInstantAt(
    facts,
    choice,
    ut,
    system,
  );
  if (instant === null) return null;
  const inFrame: FrameCoordinates = toFrame(instant, [1, 2, 3], [4, 5, 6]);
  return fromFrame(instant, inFrame.position);
}

/**
 * A widget labelling an axis has to read the scale convention off the instant,
 * because a pulsating frame's coordinate is a ratio and not a distance.
 */
export function _readsTheScaleConvention(instant: FrameInstant): string {
  const convention: TrajectoryScaleConvention = instant.scaleConvention;
  return convention === TRAJECTORY_SCALE_CONVENTIONS.metres ? "m" : "ratio";
}

/** A frame control builds its options from the enumeration, not from literals. */
export const _offersEveryKind: readonly ReadFrameKind[] = READ_FRAME_KINDS;

/** A wire vector is what an author actually holds, and this is the one door in. */
export function _transformsAWireVector(
  instant: FrameInstant,
  position: Vec3Of<"m">,
  velocity: Vec3Of<"m/s">,
): FrameVector3 {
  return toFrame(instant, frameVector(position), frameVector(velocity))
    .position;
}

const _metre: Vec3Of<"m"> = {
  x: value("m", 1),
  y: value("m", 2),
  z: value("m", 3),
};

/**
 * The unit constraint is the reason `frameVector` exists rather than the
 * conversion being written at each call site. A dimensionless vector reads as a
 * position perfectly well once its components are loose numbers.
 */
export const _refusesADimensionlessVector: FrameVector3 = frameVector(
  // @ts-expect-error: "1" is not a length or a speed, so it is not a frame input
  { x: value("1", 1), y: value("1", 0), z: value("1", 0) } as Vec3Of<"1">,
);

/** The unit-carrying vector is NOT a frame input, however much the name suggests it. */
export const _refusesTheWireShapeDirectly = (
  instant: FrameInstant,
): FrameVector3 =>
  // @ts-expect-error: the wire shape has to go through `frameVector` first
  toFrame(instant, _metre).position;

/** And the tuple is not a wire vector either, so the two cannot be crossed silently. */
// @ts-expect-error: a tuple has no `x`/`y`/`z` leaves carrying units
export const _tupleIsNotAWireVector: Vector3<"m"> = [1, 2, 3] as FrameVector3;
