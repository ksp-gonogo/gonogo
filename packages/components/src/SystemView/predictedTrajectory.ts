/**
 * Multi-SOI predicted-trajectory sampling for the SystemView diagram, on the patch-chain propagator MapView walks too (`patchArc`).
 *
 * Everything here is parent-centred inertial METRES with `z` kept; the diagram places it into the frame in force. A patch around the frame body draws at the origin, one around a child draws offset to that child, and the first sample of a non-initial patch is the SOI crossing.
 *
 * Not a reckoner: a reckoner carries a Topic's own value forward past its last observation, whereas this walks the patch chain the game's solver already published (`orbitPatches`) and samples each conic into a polyline. The windows and the SOI transitions come off the wire, so there is no observed value being carried and no uncertainty to label; the output is drawing geometry that sits on no channel, and `registerReckoner` takes a `TopicId`.
 */
import {
  isPatchElliptical,
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
  /** Whether this is the live orbit: the first elliptical patch around the frame body containing `ut`. */
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
  /** The frame's children in parent-centred metres, keyed by name, for offsetting encounter arcs; the frame body is the origin. */
  childOffsets: ReadonlyMap<string, PatchPoint>;
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

/** Where a patch's reference body sits on this frame, or `null` when the frame does not draw it. */
function frameOffset(
  referenceBody: string,
  parentName: string,
  childOffsets: ReadonlyMap<string, PatchPoint>,
): PatchPoint | null {
  if (sameBody(referenceBody, parentName)) return { x: 0, y: 0, z: 0 };
  for (const [name, pos] of childOffsets) {
    if (sameBody(name, referenceBody)) return pos;
  }
  return null;
}

/** Samples every patch around the frame parent or a drawn child; a patch around an off-screen body belongs to another frame and is skipped. */
export function predictTrajectory({
  patches,
  parentName,
  ut,
  childOffsets,
  samplesPerPatch = DEFAULT_SAMPLES,
}: PredictTrajectoryArgs): PredictedTrajectory {
  const out: ProjectedPatch[] = [];
  const encounters: EncounterMarker[] = [];
  if (patches.length === 0) {
    return { patches: out, encounters };
  }
  const steps = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(samplesPerPatch)));

  // The live patch is the first elliptical one orbiting the frame parent whose window contains `ut`.
  let currentIndex = -1;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (
      sameBody(p.referenceBody, parentName) &&
      isPatchElliptical(p) &&
      patchHolds(p, ut)
    ) {
      currentIndex = i;
      break;
    }
  }

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    if (!isPatchElliptical(patch)) continue;

    const offset = frameOffset(patch.referenceBody, parentName, childOffsets);
    if (offset === null) continue;

    // The live patch draws from `ut` forward; the live-orbit ellipse already shows the full loop.
    const arc = patchArc(patch, steps, i === currentIndex ? ut : undefined);
    if (arc.length === 0) continue;
    const points: PatchPoint[] = arc.map(({ state }) => ({
      x: offset.x + state.x,
      y: offset.y + state.y,
      z: offset.z + state.z,
    }));

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
