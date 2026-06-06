/**
 * Multi-SOI predicted-trajectory projection for the top-down SystemView
 * diagram. Reuses the same Keplerian propagator as MapView's ground-track
 * (`patchStateAt`), but projects the inertial XYZ state onto the diagram's
 * reference plane (x, y) instead of converting to lat/lon.
 *
 * SystemView renders one parent frame at a time (e.g. Kerbin with its moons).
 * An `o.orbitPatches` array can span several SOIs:
 *
 *   - A patch whose `referenceBody` matches the rendered frame is the vessel's
 *     trajectory **around the frame body** — drawn at the frame's plot scale,
 *     origin at the parent (same convention as `bodyPosition`).
 *   - A patch whose `referenceBody` is one of the frame's **children** (a moon
 *     the vessel encounters) is drawn in that child's local frame, offset to
 *     the child's drawn position. The encounter loop is small relative to the
 *     parent-orbit scale — exactly the visual cue "you pass close to this
 *     body here".
 *
 * The first sample of any non-initial patch (ENCOUNTER / ESCAPE transition) is
 * the SOI-crossing point — surfaced separately as an encounter marker.
 */
import { type OrbitPatch, patchStateAt } from "@gonogo/core";

/** A point on a predicted arc, in diagram-local px (origin = frame parent). */
export interface ProjectedPoint {
  x: number;
  y: number;
}

/** Patch transition kinds we treat as visible SOI events. */
const ENCOUNTER_TRANSITIONS = new Set(["ENCOUNTER", "ESCAPE"]);

export type EncounterKind = "encounter" | "escape";

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
  /** Sampled polyline in diagram-local px. */
  points: ProjectedPoint[];
  /**
   * SOI transition at the *start* of this patch, if any. The transition point
   * is `points[0]`. `null` for the initial patch.
   */
  startEncounter: EncounterKind | null;
}

export interface EncounterMarker {
  /** Diagram-local px of the SOI-crossing point. */
  x: number;
  y: number;
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
 * Project a patch's inertial state at `ut` into the diagram's top-down (x, y)
 * plane. The propagator places periapsis along +x with the orbit's angular
 * momentum along +z; the reference-plane projection drops z, matching
 * `bodyPosition`'s inclination-agnostic top-down convention. `offset` shifts
 * the arc to the reference body's drawn position (zero for the frame parent).
 */
function projectAt(
  patch: OrbitPatch,
  ut: number,
  scale: number,
  offset: ProjectedPoint,
): ProjectedPoint {
  const state = patchStateAt(patch, ut);
  return {
    x: offset.x + state.x * scale,
    y: offset.y + state.y * scale,
  };
}

export interface PredictTrajectoryArgs {
  patches: readonly OrbitPatch[];
  /** Body the diagram is framed around. */
  parentName: string;
  /** Current universal time — identifies the live patch. */
  ut: number;
  /** metres → px (the diagram's `plotScale`). */
  scale: number;
  /**
   * Drawn px positions of the frame's children, keyed by body name. Used to
   * offset encounter arcs around the moon the vessel passes. The parent frame
   * itself is the origin (0, 0).
   */
  childOffsets: ReadonlyMap<string, ProjectedPoint>;
  /** Samples per patch arc. Capped to bound work; defaults to 64. */
  samplesPerPatch?: number;
}

const DEFAULT_SAMPLES = 64;
const MAX_SAMPLES = 128;

/** Case + whitespace insensitive body-name compare (Telemachus casing drift). */
function sameBody(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Sample and project every renderable patch in `patches` for the current
 * frame. Patches orbiting the frame parent draw at the origin; patches
 * orbiting a drawn child draw offset to that child. Patches orbiting a body
 * that isn't on screen (a different SOI entirely) are skipped — they belong to
 * another frame.
 */
export function predictTrajectory({
  patches,
  parentName,
  ut,
  scale,
  childOffsets,
  samplesPerPatch = DEFAULT_SAMPLES,
}: PredictTrajectoryArgs): PredictedTrajectory {
  const out: ProjectedPatch[] = [];
  const encounters: EncounterMarker[] = [];
  if (patches.length === 0 || scale <= 0) {
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
    let offset: ProjectedPoint | null = null;
    if (sameBody(patch.referenceBody, parentName)) {
      offset = { x: 0, y: 0 };
    } else {
      for (const [name, pos] of childOffsets) {
        if (sameBody(name, patch.referenceBody)) {
          offset = pos;
          break;
        }
      }
    }
    if (offset === null) continue; // Reference body not on this frame.

    // For the live patch, only draw from `ut` forward — the past arc is behind
    // the vessel and the live-orbit ellipse already shows the full loop.
    const from =
      i === currentIndex ? Math.max(patch.startUT, ut) : patch.startUT;
    const to = patch.endUT;
    if (!(to > from)) continue;

    const points: ProjectedPoint[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = from + ((to - from) * s) / steps;
      points.push(projectAt(patch, t, scale, offset));
    }

    const startEncounter: EncounterKind | null = ENCOUNTER_TRANSITIONS.has(
      patch.patchStartTransition,
    )
      ? patch.patchStartTransition === "ESCAPE"
        ? "escape"
        : "encounter"
      : null;

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
 * patches — it's the source of truth for the AlmanacPanel encounter text,
 * which wants every future encounter regardless of which body the diagram is
 * framed around. Returned in chronological order, filtered to `ut` onward.
 */
export function scanEncounters(
  patches: readonly OrbitPatch[],
  ut: number,
): PatchEncounter[] {
  const out: PatchEncounter[] = [];
  for (const patch of patches) {
    if (!ENCOUNTER_TRANSITIONS.has(patch.patchStartTransition)) continue;
    if (patch.startUT < ut) continue;
    out.push({
      kind: patch.patchStartTransition === "ESCAPE" ? "escape" : "encounter",
      body: patch.referenceBody,
      ut: patch.startUT,
    });
  }
  out.sort((a, b) => a.ut - b.ut);
  return out;
}
