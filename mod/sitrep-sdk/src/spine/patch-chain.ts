/**
 * The patch chain the game published for a craft (`vessel.orbit.patches`, or a
 * manoeuvre node's), sampled into the arcs and sphere-of-influence crossings a
 * diagram draws about one frame body, on the same patch propagator the ground
 * track walks (`patchArc`).
 *
 * Everything here is frame-body-centred inertial metres with `z` kept; a caller
 * places it into whatever frame it draws in. A patch around the frame body
 * draws at the origin, one around a child draws offset to that child, and the
 * first sample of a non-initial patch is the crossing into it.
 *
 * A closed patch about a child is drawn about the child where it is when the
 * patch begins, so a capture orbit keeps its shape. An open one is a pass
 * through the child's sphere of influence, in at one edge and out at the other,
 * so each of its samples is offset by where the child is at that sample's own
 * instant: that is the craft's path in this frame, and it meets the patch
 * before it and the patch after it.
 *
 * Not a reckoner: a reckoner carries a Topic's own value forward past its last
 * observation, whereas this walks the patch chain the game's solver already
 * published and samples each conic into a polyline. The windows and the
 * transitions come off the wire, so there is no observed value being carried
 * and no uncertainty to label; the output is drawing geometry that sits on no
 * channel, and `registerReckoner` takes a `TopicId`.
 */
import { type OrbitPatch, TransitionType } from "../__generated__/contract";
import { type Value, value } from "../unit-system/value";
import { systemPosesAt } from "./body-pose";
import type { CelestialFacts } from "./celestial-facts";
import {
  canPropagatePatch,
  type PatchSpan,
  patchArc,
  patchHolds,
} from "./orbit-patches";

/**
 * A point of a sampled patch chain: metres from the frame body's centre, in
 * the catalogue's inertial axes.
 *
 * @category Orbits and trajectories
 */
export interface PatchChainPoint {
  /** Metres along the catalogue's x axis. */
  x: number;
  /** Metres along the catalogue's y axis. */
  y: number;
  /** Metres along the catalogue's z axis, out of the reference plane. */
  z: number;
}

/**
 * Which way a craft crosses a sphere of influence: `encounter` into a body's,
 * `escape` out of one.
 *
 * @category Orbits and trajectories
 */
export type SoiCrossingKind = "encounter" | "escape";

/**
 * Returns which way a patch transition crosses a sphere of influence, or
 * `null` when it does not cross one: a burn, an impact, the start or the end
 * of the chain.
 *
 * @category Orbits and trajectories
 */
export function soiCrossingKind(
  transition: TransitionType,
): SoiCrossingKind | null {
  /*
   * Exhaustive by design: the `never` binding stops compiling when
   * `TransitionType` grows a member, so a new transition cannot silently draw
   * no marker. An ordinal that is not a member yields `null`, not a guess.
   */
  switch (transition) {
    case TransitionType.Encounter:
      return "encounter";
    case TransitionType.Escape:
      return "escape";
    case TransitionType.Initial:
    case TransitionType.Final:
    // A burn, not a crossing: same sphere of influence on both sides of it.
    case TransitionType.Maneuver:
    // An impact ends the trajectory rather than moving it to another body.
    case TransitionType.Collision:
    case TransitionType.Unknown:
      return null;
    default: {
      const unruled: never = transition;
      void unruled;
      return null;
    }
  }
}

/**
 * A patch as the chain samples it: its conic, its window, the body it is
 * around and how the craft enters it. An `OrbitPatch` off the wire is one.
 *
 * @category Orbits and trajectories
 */
export type PatchChainPatch = PatchSpan &
  Pick<OrbitPatch, "patchStartTransition">;

/**
 * One patch of the chain as a sampled arc about the frame body.
 *
 * @category Orbits and trajectories
 */
export interface PatchChainArc {
  /** Index of the patch in the array the chain was sampled from. */
  patchIndex: number;
  /** Name of the body this patch is around. */
  referenceBody: string;
  /** Whether this is the patch the craft is on now: the first one around the frame body that can be propagated and holds the instant asked about. */
  isCurrent: boolean;
  /** The sampled arc, in order of time. */
  points: PatchChainPoint[];
  /** The crossing the craft enters this patch by, at `points[0]`, or `null` when it enters it any other way. */
  startCrossing: SoiCrossingKind | null;
}

/**
 * Where and when a craft crosses a sphere of influence, as a point about the
 * frame body.
 *
 * @category Orbits and trajectories
 */
export interface SoiCrossing extends PatchChainPoint {
  /** Which way the craft crosses. */
  kind: SoiCrossingKind;
  /** Name of the body whose sphere of influence is entered or left. */
  body: string;
  /** The instant of the crossing. */
  ut: Value<"ut">;
  /** Index of the patch the crossing begins. */
  patchIndex: number;
}

/**
 * A craft's patch chain sampled about one frame body: an arc for each patch
 * that can be drawn there, and each crossing of a sphere of influence.
 *
 * @category Orbits and trajectories
 */
export interface PatchChain {
  /** The arcs, in chain order. A patch that cannot be propagated, has ended, or is around a body with no place about the frame body has none. */
  arcs: PatchChainArc[];
  /** The crossings, in chain order. */
  crossings: SoiCrossing[];
}

/**
 * What {@link patchChain} samples.
 *
 * @category Orbits and trajectories
 */
export interface PatchChainInput {
  /** The chain, in the order the game published it. */
  patches: readonly PatchChainPatch[];
  /** Name of the body the arcs are drawn about. */
  frameBodyName: string;
  /** The instant asked about, in UT seconds: it picks the current patch, whose arc starts there. */
  ut: number;
  /** Where a body is relative to the frame body at a UT, in metres, or `null` when it has no place then. Asked at a closed patch's own start, and at each sample's instant along an open one. */
  offsetAt: (bodyName: string, ut: number) => PatchChainPoint | null;
  /** Samples along each arc, from 2 to 128. Defaults to 64. */
  samplesPerPatch?: number;
}

/**
 * Returns where `bodyName` is relative to `frameBodyName` at `ut`, in metres
 * and the catalogue's inertial axes, or `null` when either body has no place
 * at that instant. `catalogueAsOfUt` is when the catalogue stopped arriving,
 * or `null` while it is current.
 *
 * @category Orbits and trajectories
 */
export function bodyOffsetAt(
  facts: CelestialFacts,
  frameBodyName: string,
  bodyName: string,
  ut: number,
  catalogueAsOfUt: number | null,
): PatchChainPoint | null {
  const frameIndex = facts.indexByName[frameBodyName];
  const bodyIndex = facts.indexByName[bodyName];
  if (frameIndex === undefined || bodyIndex === undefined) return null;
  const poses = systemPosesAt(facts, ut, catalogueAsOfUt).poseByIndex;
  const frame = poses[frameIndex]?.position;
  const body = poses[bodyIndex]?.position;
  if (!frame || !body) return null;
  return {
    x: body[0] - frame[0],
    y: body[1] - frame[1],
    z: body[2] - frame[2],
  };
}

const DEFAULT_SAMPLES = 64;
const MAX_SAMPLES = 128;

/** Case + whitespace insensitive body-name compare (body-name casing drifts). */
function sameBody(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const FRAME_BODY: PatchChainPoint = { x: 0, y: 0, z: 0 };

/** Whether a patch is a pass through the sphere of influence of a body the frame draws as a child, whose samples are each offset by that body's place at their own instant. */
function movesWithItsBody(
  patch: PatchChainPatch,
  frameBodyName: string,
): boolean {
  return (
    !sameBody(patch.referenceBody, frameBodyName) && patch.ecc.greaterThan(1)
  );
}

/** Where a patch's reference body sits on this frame at `ut`, or `null` when the frame does not draw it. */
function frameOffset(
  patch: PatchChainPatch,
  frameBodyName: string,
  offsetAt: PatchChainInput["offsetAt"],
  ut: number,
): PatchChainPoint | null {
  if (sameBody(patch.referenceBody, frameBodyName)) return FRAME_BODY;
  return offsetAt(patch.referenceBody, ut);
}

/**
 * Returns a craft's patch chain as arcs and sphere-of-influence crossings
 * about `frameBodyName`, in metres. Useful for showing the operator where the
 * craft goes after it leaves its present orbit: into a moon's sphere of
 * influence, past the moon, and out again. {@link usePatchChain} is the same
 * computation held between renders, which is what the system diagram draws.
 *
 * A patch about the frame body is sampled about the origin. A closed patch
 * about another body is drawn about that body where it is when the patch
 * begins; an open one (a flyby) has each sample offset by where the body is at
 * that sample's instant, so it meets the patches either side of it. The
 * current patch is sampled from `ut` on, the rest across their whole window. A
 * patch that has ended, cannot be propagated, or is about a body `offsetAt`
 * cannot place has no arc.
 *
 * @category Orbits and trajectories
 */
export function patchChain({
  patches,
  frameBodyName,
  ut,
  offsetAt,
  samplesPerPatch = DEFAULT_SAMPLES,
}: PatchChainInput): PatchChain {
  const arcs: PatchChainArc[] = [];
  const crossings: SoiCrossing[] = [];
  if (patches.length === 0) {
    return { arcs, crossings };
  }
  const steps = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(samplesPerPatch)));

  // The current patch is the first propagable one about the frame body whose window contains `ut`.
  let currentIndex = -1;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (
      sameBody(p.referenceBody, frameBodyName) &&
      canPropagatePatch(p) &&
      patchHolds(p, ut)
    ) {
      currentIndex = i;
      break;
    }
  }

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    if (!canPropagatePatch(patch)) continue;
    // A patch that ended before the instant asked about is behind the craft.
    if (patch.endUt.lessThan(value("ut", ut))) continue;

    // The current patch is sampled from `ut` on: the part behind the craft is its orbit, which a caller draws whole.
    const arc = patchArc(patch, steps, i === currentIndex ? ut : undefined);
    if (arc.length === 0) continue;
    const moving = movesWithItsBody(patch, frameBodyName);
    const atStart = moving
      ? null
      : frameOffset(patch, frameBodyName, offsetAt, patch.startUt.valueOf());
    const points: PatchChainPoint[] = [];
    for (const sample of arc) {
      const offset = moving
        ? frameOffset(patch, frameBodyName, offsetAt, sample.ut)
        : atStart;
      if (offset === null) break;
      points.push({
        x: offset.x + sample.state.x,
        y: offset.y + sample.state.y,
        z: offset.z + sample.state.z,
      });
    }
    // A body with no place at any sampled instant leaves the whole patch out: half an arc reads as a path that stops.
    if (points.length !== arc.length) continue;

    const startCrossing = soiCrossingKind(patch.patchStartTransition);

    arcs.push({
      patchIndex: i,
      referenceBody: patch.referenceBody,
      isCurrent: i === currentIndex,
      points,
      startCrossing,
    });

    if (startCrossing !== null && points.length > 0) {
      crossings.push({
        x: points[0].x,
        y: points[0].y,
        z: points[0].z,
        kind: startCrossing,
        body: patch.referenceBody,
        ut: patch.startUt,
        patchIndex: i,
      });
    }
  }

  return { arcs, crossings };
}
