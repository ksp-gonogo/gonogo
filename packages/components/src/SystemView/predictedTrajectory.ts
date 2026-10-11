/**
 * Multi-SOI predicted-trajectory sampling for the SystemView diagram, on the patch-chain propagator MapView walks too (`patchArc`).
 *
 * Everything here is parent-centred inertial metres with `z` kept; the diagram places it into the frame in force. A patch around the frame body draws at the origin, one around a child draws offset to that child, and the first sample of a non-initial patch is the SOI crossing.
 *
 * A closed patch about a child is drawn about the child where it is when the patch begins, so a capture orbit keeps its shape. An open one is a pass through the child's sphere of influence, in at one edge and out at the other, so each of its samples is offset by where the child is at that sample's own instant: that is the craft's path in this frame, and it meets the patch before it and the patch after it.
 *
 * Not a reckoner: a reckoner carries a Topic's own value forward past its last observation, whereas this walks the patch chain the game's solver already published (`orbitPatches`) and samples each conic into a polyline. The windows and the SOI transitions come off the wire, so there is no observed value being carried and no uncertainty to label; the output is drawing geometry that sits on no channel, and `registerReckoner` takes a `TopicId`.
 */
import {
  canPropagatePatch,
  type PatchSpan,
  patchArc,
  patchHolds,
} from "@ksp-gonogo/sitrep-client";
import {
  type OrbitPatch,
  TransitionType,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";

/** A point on a predicted arc in parent-centred inertial metres (origin: the frame body), never plot units. */
export interface PatchPoint {
  x: number;
  y: number;
  z: number;
}

export type EncounterKind = "encounter" | "escape";

/**
 * Which way a patch transition crosses an SOI boundary, or `null` when it does not.
 *
 * Exhaustive by design: the `never` binding stops compiling when `TransitionType` grows a member, so a new transition cannot silently draw no marker. An ordinal that is not a member yields `null` rather than a guess.
 */
export function soiEventKind(transition: TransitionType): EncounterKind | null {
  switch (transition) {
    case TransitionType.Encounter:
      return "encounter";
    case TransitionType.Escape:
      return "escape";
    case TransitionType.Initial:
    case TransitionType.Final:
    // A burn, not a crossing: same SOI on both sides of it.
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

/** A patch as the diagram samples it: its conic, its window, its body and how it begins. */
export type TrajectoryPatch = PatchSpan &
  Pick<OrbitPatch, "patchStartTransition">;

export interface ProjectedPatch {
  /** Index into the source `orbitPatches` array. */
  patchIndex: number;
  /** Body this patch orbits (its reference frame). */
  referenceBody: string;
  /** Whether this is the live orbit: the first patch around the frame body that can be propagated and contains `ut`. */
  isCurrent: boolean;
  /** Sampled polyline in parent-centred metres. */
  points: PatchPoint[];
  /**
   * SOI transition at the *start* of this patch, if any. The transition point
   * is `points[0]`. `null` for the initial patch.
   */
  startEncounter: EncounterKind | null;
}

export interface EncounterMarker {
  /** Parent-centred metres of the SOI-crossing point. */
  x: number;
  y: number;
  z: number;
  kind: EncounterKind;
  /** Body whose SOI is entered (encounter) or left (escape). */
  body: string;
  /** Universal time of the crossing. */
  ut: Value<"ut">;
  patchIndex: number;
}

export interface PredictedTrajectory {
  patches: ProjectedPatch[];
  encounters: EncounterMarker[];
}

export interface PredictTrajectoryArgs {
  patches: readonly TrajectoryPatch[];
  /** Body the diagram is framed around. */
  parentName: string;
  /** Current universal time: identifies the live patch. */
  ut: number;
  /** Where a body sits relative to the frame body at a UT, in metres, or null when it has no place then. Asked at a closed patch's own start, and at each sample's instant along an open one. */
  offsetAt: (bodyName: string, ut: number) => PatchPoint | null;
  /** Samples per patch arc. Capped to bound work; defaults to 64. */
  samplesPerPatch?: number;
}

const DEFAULT_SAMPLES = 64;
const MAX_SAMPLES = 128;

/** Case + whitespace insensitive body-name compare (body-name casing drifts). */
function sameBody(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const FRAME_BODY: PatchPoint = { x: 0, y: 0, z: 0 };

/** Whether a patch is a pass through the sphere of influence of a body the frame draws as a child, whose samples are each offset by that body's place at their own instant. */
function movesWithItsBody(patch: TrajectoryPatch, parentName: string): boolean {
  return !sameBody(patch.referenceBody, parentName) && patch.ecc.greaterThan(1);
}

/** Where a patch's reference body sits on this frame at `ut`, or `null` when the frame does not draw it. */
function frameOffset(
  patch: TrajectoryPatch,
  parentName: string,
  offsetAt: PredictTrajectoryArgs["offsetAt"],
  ut: number,
): PatchPoint | null {
  if (sameBody(patch.referenceBody, parentName)) return FRAME_BODY;
  return offsetAt(patch.referenceBody, ut);
}

/** Samples every patch around the frame parent or a drawn child; a patch around an off-screen body belongs to another frame and is skipped. */
export function predictTrajectory({
  patches,
  parentName,
  ut,
  offsetAt,
  samplesPerPatch = DEFAULT_SAMPLES,
}: PredictTrajectoryArgs): PredictedTrajectory {
  const out: ProjectedPatch[] = [];
  const encounters: EncounterMarker[] = [];
  if (patches.length === 0) {
    return { patches: out, encounters };
  }
  const steps = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(samplesPerPatch)));

  // The live patch is the first propagable one orbiting the frame parent whose window contains `ut`.
  let currentIndex = -1;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (
      sameBody(p.referenceBody, parentName) &&
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
    // A patch that ended before the instant on screen is behind the craft.
    if (patch.endUt.lessThan(value("ut", ut))) continue;

    // The live patch draws from `ut` forward; the live orbit's own ring or open arc already shows the whole of it.
    const arc = patchArc(patch, steps, i === currentIndex ? ut : undefined);
    if (arc.length === 0) continue;
    const moving = movesWithItsBody(patch, parentName);
    const atStart = moving
      ? null
      : frameOffset(patch, parentName, offsetAt, patch.startUt.valueOf());
    const points: PatchPoint[] = [];
    for (const sample of arc) {
      const offset = moving
        ? frameOffset(patch, parentName, offsetAt, sample.ut)
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

    const startEncounter = soiEventKind(patch.patchStartTransition);

    out.push({
      patchIndex: i,
      referenceBody: patch.referenceBody,
      isCurrent: i === currentIndex,
      points,
      startEncounter,
    });

    if (startEncounter !== null && points.length > 0) {
      encounters.push({
        x: points[0].x,
        y: points[0].y,
        z: points[0].z,
        kind: startEncounter,
        body: patch.referenceBody,
        ut: patch.startUt,
        patchIndex: i,
      });
    }
  }

  return { patches: out, encounters };
}

/** The earliest encounter or escape after `ut`, or null when the trajectory stays in one SOI. */
export function nextEncounter(
  trajectory: PredictedTrajectory,
  ut: number,
): { kind: EncounterKind; body: string; ut: Value<"ut"> } | null {
  const now = value("ut", ut);
  let best: EncounterMarker | null = null;
  for (const e of trajectory.encounters) {
    if (e.ut.lessThan(now)) continue;
    if (best === null || e.ut.lessThan(best.ut)) best = e;
  }
  if (best === null) return null;
  return { kind: best.kind, body: best.body, ut: best.ut };
}
