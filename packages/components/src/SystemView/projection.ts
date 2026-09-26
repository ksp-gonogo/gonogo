import { PerfBudget } from "@ksp-gonogo/core";
import {
  type CelestialFacts,
  type FrameInstant,
  frameInstantAt,
  fromFrame,
  type ReadFrameChoice,
  type SystemInstant,
  systemInstantAt,
  TRAJECTORY_SCALE_CONVENTIONS,
  type TrajectoryFrame,
  toFrame,
  trajectoryFrameKindFor,
  type Vector3,
} from "@ksp-gonogo/sitrep-client";

/**
 * How SystemView's frame is chosen and placed.
 *
 * Projection to two dimensions happens once, where a coordinate becomes an SVG attribute: a rotation into a pair-rotating frame is about an arbitrary axis and cannot be done in a flattened plane.
 */

/**
 * Body placements computed per second, recorded once per placement rather than per frame-state solve, which is the quantity that grows.
 *
 * Steady state is one diagram placing everything once per one-second UT bucket, about 3,300/sec for a stock system; placing on every render instead is about 198,000/sec. The threshold sits between them, and the two are only distinguishable because `createUtBucketThrottle` floors the bucket on wall-clock time.
 */
const SYSTEM_PLACEMENT_BUDGET = new PerfBudget({
  name: "SystemView body placements/sec",
  threshold: 25_000,
  windowMs: 1000,
  unit: "placements",
});

/** How the diagram sizes itself in a projection's own coordinates, a total union so the stock projection states `auto-fit-metres` rather than omitting it. */
export type SystemProjectionExtent =
  /** Fit the drawn orbits in metres about the frame body, for a projection whose origin is that body and whose lengths are metres. */
  | { kind: "auto-fit-metres" }
  /** A fixed half-extent in the projection's own units, for coordinates that are not metres or an origin elsewhere. */
  | { kind: "fixed-units"; units: number };

/**
 * One frame SystemView will draw its whole picture in.
 *
 * Plain data and a `ReadFrameChoice`, not a transform closure: the host resolves it through `frameInstantAt` once per picture, every frame it builds is a similarity with an inverse, and plain data keeps the contribution's reference equality meaningful.
 */
export interface SystemViewProjection {
  /** Stable id. The operator's pinned choice is stored as this. */
  id: string;
  /** What an operator calls it. A picture, not a taxonomy. */
  label: string;
  /** The frame, for the host to resolve at the instant it is drawing. */
  choice: ReadFrameChoice;
  extent: SystemProjectionExtent;
  /** The body the diagram must be centred on for this projection to apply, stated by the contributor so the host never branches on frame kind. */
  frameBodyIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "system-view.projection": {
      entry: SystemViewProjection;
      topics: "system.bodies";
    };
  }
}

/** The id of the parent-centred inertial frame. */
export function inertialProjectionId(frameBodyIndex: number): string {
  return `system-view.inertial.${frameBodyIndex}`;
}

/** The id of the frame that holds the diagram's frame body and its parent still. */
export function parentDirectionProjectionId(frameBodyIndex: number): string {
  return `system-view.parent-direction.${frameBodyIndex}`;
}

/**
 * The projections the host offers for one body it might be centred on.
 *
 * Stock registers its own inertial frame, so there is never "no frame" to branch on and the seam runs on a bare install. Contributed per body, since `compute` sees Topics and the centred body is widget config; the host filters by `frameBodyIndex` exactly as it does a third party's entries.
 */
export function projectionsForBody(
  frameBodyIndex: number,
  hasParent: boolean,
): SystemViewProjection[] {
  const entries: SystemViewProjection[] = [
    {
      id: inertialProjectionId(frameBodyIndex),
      label: "Hold the sky still (the ordinary view)",
      choice: { kind: "body-centred-inertial", bodyIndex: frameBodyIndex },
      extent: { kind: "auto-fit-metres" },
      frameBodyIndex,
    },
  ];
  // The root star has no parent to hold still, so that frame cannot be formed.
  if (hasParent) {
    entries.push({
      id: parentDirectionProjectionId(frameBodyIndex),
      label: "Hold the parent still (transfer windows)",
      choice: { kind: "parent-direction", bodyIndex: frameBodyIndex },
      extent: { kind: "auto-fit-metres" },
      frameBodyIndex,
    });
  }
  return entries;
}

/** A projection resolved at one instant: both transforms, held as `FrameInstant`s so the frame work is paid once per picture, plus what the diagram needs about its coordinates. */
export interface ResolvedProjection extends Placement {
  id: string;
  /** What the caption says the picture is drawn in. */
  frame: TrajectoryFrame;
  /** Whether a coordinate in this projection is a length at all. */
  lengthsPulsate: boolean;
}

/** What the diagram draws through, never nullable: the diagram's one coalesce falls back to {@link INERTIAL_PLACEMENT}, a named frame rather than an absence. */
export interface Placement {
  place(parentCentred: Vector3): Vector3;
  unplace(projected: Vector3): Vector3;
  extent: SystemProjectionExtent;
}

/** The frame the diagram's own coordinates arrive in, used when the catalogue cannot form the requested frame; the widget names it beside the picture. */
export const INERTIAL_PLACEMENT: Placement = {
  place: (p) => p,
  unplace: (p) => p,
  extent: { kind: "auto-fit-metres" },
};

/** The frame {@link INERTIAL_PLACEMENT} draws in, so the caption names the same frame the placement uses. */
export function inertialFrameFor(frameBodyIndex: number): TrajectoryFrame {
  return {
    kind: trajectoryFrameKindFor("body-centred-inertial"),
    centreBodyIndex: frameBodyIndex,
    lengthsPulsate: false,
    scaleConvention: TRAJECTORY_SCALE_CONVENTIONS.metres,
  };
}

/** The projection in force at `ut`, or null when the catalogue cannot form it (an uncarried body, the root star asked for a parent frame, a degenerate pair); the caller says so on screen. */
export function resolveProjection(
  facts: CelestialFacts | undefined,
  frameBodyIndex: number | undefined,
  entry: SystemViewProjection | null,
  ut: number | null,
): ResolvedProjection | null {
  if (
    facts === undefined ||
    frameBodyIndex === undefined ||
    entry === null ||
    ut === null ||
    !Number.isFinite(ut)
  ) {
    return null;
  }
  const system: SystemInstant = systemInstantAt(facts, ut);
  // The diagram's own body-centred frame, which turns its positions into root-centred inertial coordinates the chosen frame accepts.
  const diagram = frameInstantAt(
    facts,
    { kind: "body-centred-inertial", bodyIndex: frameBodyIndex },
    ut,
    system,
  );
  const chosen = frameInstantAt(facts, entry.choice, ut, system);
  if (diagram === null || chosen === null) return null;
  const sides = frameSidesOf(facts, entry.choice);
  return {
    id: entry.id,
    place: (parentCentred) => placeThrough(diagram, chosen, parentCentred),
    unplace: (projected) => placeThrough(chosen, diagram, projected),
    extent: entry.extent,
    lengthsPulsate:
      chosen.scaleConvention !== TRAJECTORY_SCALE_CONVENTIONS.metres,
    frame: {
      kind: trajectoryFrameKindFor(entry.choice.kind),
      centreBodyIndex: entry.choice.bodyIndex ?? frameBodyIndex,
      lengthsPulsate:
        chosen.scaleConvention !== TRAJECTORY_SCALE_CONVENTIONS.metres,
      primaryBodyIndex: sides?.primary,
      secondaryBodyIndex: sides?.secondary,
      scaleConvention: chosen.scaleConvention,
      unitLength: chosen.unitLength,
    },
  };
}

/** A position in `from`'s coordinates re-expressed in `to`'s; one helper serves both directions, so the inverse cannot drift. */
function placeThrough(
  from: FrameInstant,
  to: FrameInstant,
  position: Vector3,
): Vector3 {
  SYSTEM_PLACEMENT_BUDGET.record();
  return toFrame(to, fromFrame(from, position)).position;
}

/** The pair a frame is named for, as the head index of each side `frameSides` returns. */
function frameSidesOf(
  facts: CelestialFacts,
  choice: ReadFrameChoice,
): { primary: number; secondary: number } | null {
  if (choice.kind === "body-centred-inertial") return null;
  const bodyIndex = choice.bodyIndex;
  if (bodyIndex == null) return null;
  const body = facts.bodies.find((b) => b.index === bodyIndex);
  const parentName = body?.referenceBody;
  if (parentName == null) return null;
  const parentIndex = facts.indexByName[parentName];
  if (parentIndex === undefined) return null;
  // `parent-direction` names the selected body first; a pulsating frame names its pair the other way about, as the producer does.
  return choice.kind === "parent-direction"
    ? { primary: bodyIndex, secondary: parentIndex }
    : { primary: parentIndex, secondary: bodyIndex };
}
