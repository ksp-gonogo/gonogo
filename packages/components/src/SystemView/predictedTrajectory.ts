/**
 * Multi-SOI predicted-trajectory sampling for the SystemView diagram. Reuses the
 * same Keplerian propagator as MapView's ground-track (`patchStateAt`) and keeps
 * the whole inertial state.
 *
 * <b>`z` is kept, not dropped.</b> `patchStateAt` answers with a full
 * three-dimensional parent-centred position, and taking only two components of
 * it flattens the arc while the bodies around it stay three-dimensional.
 * Everything below is parent-centred METRES; the diagram places it into the
 * frame in force and scales it, so the predicted arc lands in the same frame as
 * the bodies it passes.
 *
 * SystemView renders one parent frame at a time (e.g. Kerbin with its moons).
 * An `o.orbitPatches` array can span several SOIs:
 *
 *   - A patch whose `referenceBody` matches the rendered frame is the vessel's
 *     trajectory **around the frame body**: drawn at the frame's plot scale,
 *     origin at the frame body.
 *   - A patch whose `referenceBody` is one of the frame's **children** (a moon
 *     the vessel encounters) is drawn in that child's local frame, offset to
 *     the child's drawn position. The encounter loop is small relative to the
 *     parent-orbit scale: exactly the visual cue "you pass close to this
 *     body here".
 *
 * The first sample of any non-initial patch (ENCOUNTER / ESCAPE transition) is
 * the SOI-crossing point: surfaced separately as an encounter marker.
 */
import { type OrbitPatch, patchStateAt } from "@ksp-gonogo/core";
import type { TransitionName } from "@ksp-gonogo/sitrep-client";

/**
 * A point on a predicted arc, in parent-centred inertial METRES (origin = the
 * frame body). Not plot units: the diagram places and scales it, and offsetting a
 * moon-local arc after the frame transform would add a translation the transform
 * has already accounted for.
 */
export interface PatchPoint {
  x: number;
  y: number;
  z: number;
}

export type EncounterKind = "encounter" | "escape";

/**
 * Which way a patch transition crosses an SOI boundary, or `null` when it does
 * not cross one at all.
 *
 * The single place this diagram decides what an SOI event is, and it is
 * exhaustive on purpose. Deciding by membership of a hand-written set instead
 * makes any transition outside the set silently not an event, so a member
 * appended to `TransitionType` draws no marker on the diagram and lists no row
 * in the almanac, and an operator cannot tell that from a trajectory that
 * genuinely stays in one SOI.
 *
 * `TransitionName` is derived from the generated enum, so the `never` binding
 * below stops compiling the moment C# grows a member, and whoever adds it has
 * to say whether it crosses. That is the whole guarantee: the decision is on a
 * string because `patchStartTransition` reaches the diagram as a name, and a
 * string branch is only safe while it is exhaustive.
 *
 * A name that is not a transition at all yields `null` rather than a guess.
 * Marking a crossing would put a body's name and a UT on the diagram off a
 * value that was never read.
 */
export function soiEventKind(transition: string): EncounterKind | null {
  // Widened at the boundary rather than inside the switch, so the `default`
  // arm narrows this binding and not a fresh cast: casting there would assert
  // exhaustiveness instead of checking it.
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
  /**
   * Whether this patch is the live current orbit (the first elliptical patch
   * orbiting the rendered frame body and containing `ut`). Drives the green
   * vs. de-emphasised styling in the diagram.
   */
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

/**
 * A patch's parent-centred inertial state at `ut`, metres, offset to where its
 * reference body sits. `offset` is the frame body's own zero for a patch orbiting
 * the frame body, and the moon's parent-centred position for an encounter patch.
 *
 * Composed in metres rather than in drawn coordinates. A frame transform is
 * affine, so placing the arc and then adding a placed offset would apply the
 * frame's own translation twice; adding first and placing the sum is exact in
 * every frame.
 */
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
  /**
   * Parent-centred positions of the frame's children in METRES, keyed by body
   * name. Used to offset encounter arcs around the moon the vessel passes. The
   * frame body itself is the origin.
   */
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

/**
 * Sample and project every renderable patch in `patches` for the current
 * frame. Patches orbiting the frame parent draw at the origin; patches
 * orbiting a drawn child draw offset to that child. Patches orbiting a body
 * that isn't on screen (a different SOI entirely) are skipped, they belong to
 * another frame.
 */
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

  // The live patch is the first elliptical one orbiting the frame parent whose
  // [startUT, endUT] window contains `ut`.
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

    // Resolve where this patch's reference body sits in the diagram.
    let offset: PatchPoint | null = null;
    if (sameBody(patch.referenceBody, parentName)) {
      offset = { x: 0, y: 0, z: 0 };
    } else {
      for (const [name, pos] of childOffsets) {
        if (sameBody(name, patch.referenceBody)) {
          offset = pos;
          break;
        }
      }
    }
    if (offset === null) continue; // Reference body not on this frame.

    // For the live patch, only draw from `ut` forward, the past arc is behind
    // the vessel and the live-orbit ellipse already shows the full loop.
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

/**
 * Summarise the next SOI event for the AlmanacPanel / subtitle. Picks the
 * earliest encounter/escape after `ut`. Returns null when the trajectory stays
 * in one SOI.
 */
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

/**
 * Scan raw orbit patches for SOI crossings, independent of the rendered frame.
 * Unlike {@link predictTrajectory} this doesn't project or skip off-frame
 * patches: it's the source of truth for the AlmanacPanel encounter text,
 * which wants every future encounter regardless of which body the diagram is
 * framed around. Returned in chronological order, filtered to `ut` onward.
 */
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
