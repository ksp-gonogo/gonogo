/**
 * Multi-SOI predicted-trajectory sampling for the SystemView diagram, on MapView's Keplerian propagator (`patchStateAt`).
 *
 * Everything here is parent-centred inertial METRES with `z` kept; the diagram places it into the frame in force. A patch around the frame body draws at the origin, one around a child draws offset to that child, and the first sample of a non-initial patch is the SOI crossing.
 */
import { type OrbitPatch, patchStateAt } from "@ksp-gonogo/core";
import type { TransitionName } from "@ksp-gonogo/sitrep-client";

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
 * Exhaustive by design: the `never` binding stops compiling when `TransitionType` grows a member, so a new transition cannot silently draw no marker. A name that is not a transition yields `null` rather than a guess.
 */
export function soiEventKind(transition: string): EncounterKind | null {
  // Widened here so the default arm narrows this binding, checking exhaustiveness rather than asserting it.
  const named = transition as TransitionName;
  switch (named) {
    case "ENCOUNTER":
      return "encounter";
    case "ESCAPE":
      return "escape";
    case "INITIAL":
    case "FINAL":
    // A burn, not a crossing: same SOI on both sides of it.
    case "MANEUVER":
    // An impact ends the trajectory rather than moving it to another body.
    case "COLLISION":
    case "UNKNOWN":
      return null;
    default: {
      const unruled: never = named;
      void unruled;
      return null;
    }
  }
}

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
  ut: number;
  patchIndex: number;
}

export interface PredictedTrajectory {
  patches: ProjectedPatch[];
  encounters: EncounterMarker[];
}

/** A patch is propagable with the elliptical solver. Hyperbolic / parabolic aren't. */
function isElliptical(patch: OrbitPatch): boolean {
  return (
    patch.eccentricity < 1 && Number.isFinite(patch.period) && patch.period > 0
  );
}

/** A patch's parent-centred state at `ut` in metres plus its reference body's offset, composed before placement so a frame's translation applies once. */
function patchPointAt(
  patch: OrbitPatch,
  ut: number,
  offset: PatchPoint,
): PatchPoint {
  const state = patchStateAt(patch, ut);
  return {
    x: offset.x + state.x,
    y: offset.y + state.y,
    z: offset.z + state.z,
  };
}

export interface PredictTrajectoryArgs {
  patches: readonly OrbitPatch[];
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

  // The live patch is the first elliptical one orbiting the frame parent whose [startUT, endUT] window contains `ut`.
  let currentIndex = -1;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (
      sameBody(p.referenceBody, parentName) &&
      isElliptical(p) &&
      ut >= p.startUT &&
      ut <= p.endUT
    ) {
      currentIndex = i;
      break;
    }
  }

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    if (!isElliptical(patch)) continue;

    const offset = frameOffset(patch.referenceBody, parentName, childOffsets);
    if (offset === null) continue;

    // The live patch draws from `ut` forward; the live-orbit ellipse already shows the full loop.
    const from =
      i === currentIndex ? Math.max(patch.startUT, ut) : patch.startUT;
    const to = patch.endUT;
    if (!(to > from)) continue;

    const points: PatchPoint[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = from + ((to - from) * s) / steps;
      points.push(patchPointAt(patch, t, offset));
    }

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
        ut: patch.startUT,
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
): { kind: EncounterKind; body: string; ut: number } | null {
  let best: EncounterMarker | null = null;
  for (const e of trajectory.encounters) {
    if (e.ut < ut) continue;
    if (best === null || e.ut < best.ut) best = e;
  }
  if (best === null) return null;
  return { kind: best.kind, body: best.body, ut: best.ut };
}

export interface PatchEncounter {
  kind: EncounterKind;
  /** Body whose SOI is entered (encounter) or left (escape). */
  body: string;
  /** Universal time of the crossing. */
  ut: number;
}

/** Every SOI crossing from `ut` onward in chronological order, independent of the rendered frame, for the almanac encounter text. */
export function scanEncounters(
  patches: readonly OrbitPatch[],
  ut: number,
): PatchEncounter[] {
  const out: PatchEncounter[] = [];
  for (const patch of patches) {
    const kind = soiEventKind(patch.patchStartTransition);
    if (kind === null) continue;
    if (patch.startUT < ut) continue;
    out.push({ kind, body: patch.referenceBody, ut: patch.startUT });
  }
  out.sort((a, b) => a.ut - b.ut);
  return out;
}
