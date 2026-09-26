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
 * SystemView's three-dimensional arithmetic and how its frame is chosen.
 *
 * Projection to two dimensions happens once, where a coordinate becomes an SVG attribute: a rotation into a pair-rotating frame is about an arbitrary axis and cannot be done in a flattened plane. The dropped component is the depth the diagram colours with, which is not inclination: a body at its ascending node has no depth.
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

/**
 * How many points a drawn orbit ring is sampled into.
 *
 * Every ring is a sampled polyline, even under the identity projection: a projected or rotating-frame orbit is not an ellipse `cx`/`cy` can express. At 96 samples the polyline departs from the true curve by about `(pi/96)^2 / 2` of the semi-major axis, 0.16px on a 300px orbit.
 */
export const ORBIT_RING_SAMPLES = 96;

const RAD = Math.PI / 180;

function clampEcc(eccentricity: number): number {
  return Math.min(Math.max(eccentricity, 0), 0.999);
}

/** A point on a Keplerian orbit in the parent's inertial frame, metres, through the full perifocal-to-inertial rotation (argPe, then inclination, then lan). */
export function orbitPointAt(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  trueAnomalyDeg: number,
): Vector3 {
  const e = clampEcc(eccentricity);
  const theta = trueAnomalyDeg * RAD;
  const r = (sma * (1 - e * e)) / (1 + e * Math.cos(theta));
  return perifocalToParent(
    r * Math.cos(theta),
    r * Math.sin(theta),
    lanDeg,
    argPeDeg,
    inclinationDeg,
  );
}

/** A perifocal offset (periapsis on `+x`, motion toward `+y`, normal on `+z`) in the parent's inertial frame, metres; `z` is kept because an integrated arc leaves the osculating plane. */
export function perifocalToParent(
  xPerifocal: number,
  yPerifocal: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  zPerifocal = 0,
): Vector3 {
  const lan = lanDeg * RAD;
  const argPe = argPeDeg * RAD;
  const inc = inclinationDeg * RAD;
  const cosW = Math.cos(argPe);
  const sinW = Math.sin(argPe);
  const cosO = Math.cos(lan);
  const sinO = Math.sin(lan);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);
  // Rotate by argPe in the orbit plane first, so what follows is the standard node-line tilt applied to a point measured from the ascending node.
  const xn = xPerifocal * cosW - yPerifocal * sinW;
  const yn = xPerifocal * sinW + yPerifocal * cosW;
  return [
    xn * cosO - yn * sinO * cosI + zPerifocal * sinO * sinI,
    xn * sinO + yn * cosO * cosI - zPerifocal * cosO * sinI,
    yn * sinI + zPerifocal * cosI,
  ];
}

/** The whole ring of an orbit in the parent's inertial frame, metres, sampled uniformly in eccentric anomaly so points spread along the arc instead of piling up at apoapsis. */
export function orbitRingPoints(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  samples: number = ORBIT_RING_SAMPLES,
): Vector3[] {
  const e = clampEcc(eccentricity);
  const b = sma * Math.sqrt(1 - e * e);
  const points: Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const anomaly = (2 * Math.PI * i) / samples;
    points.push(
      perifocalToParent(
        sma * (Math.cos(anomaly) - e),
        b * Math.sin(anomaly),
        lanDeg,
        argPeDeg,
        inclinationDeg,
      ),
    );
  }
  return points;
}

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

/** Depth in SCREEN pixels at which the cue reads full strength, so a tilt reads only once it is actually visible at the current zoom. */
const DEPTH_FULL_SCALE_PX = 40;

/** Above the reference plane. */
export const DEPTH_ABOVE_COLOUR = "rgb(230, 90, 90)";
/** In it. */
export const DEPTH_LEVEL_COLOUR = "rgb(160, 160, 170)";
/** Below it. */
export const DEPTH_BELOW_COLOUR = "rgb(80, 130, 230)";

/** How strongly a depth of `depthPx` screen pixels should read, 0 to 1. */
export function depthStrength(depthPx: number): number {
  return Math.min(Math.abs(depthPx) / DEPTH_FULL_SCALE_PX, 1);
}

/** Which side of the reference plane `depthPx` is, as a colour. */
export function depthColour(depthPx: number): string {
  if (depthPx > 0) return DEPTH_ABOVE_COLOUR;
  if (depthPx < 0) return DEPTH_BELOW_COLOUR;
  return DEPTH_LEVEL_COLOUR;
}

export interface DepthGradientAxis {
  /** Gradient start, in plot units: where the curve is deepest below the plane. */
  x1: number;
  y1: number;
  /** Gradient end: where it is highest above it. */
  x2: number;
  y2: number;
  /** Half the depth spread along the curve in PLOT units; the caller multiplies by zoom, which keeps placement memoisable across a wheel gesture. */
  depthUnits: number;
}

/**
 * The axis a curve's depth varies along, between the projected positions of its deepest and highest samples.
 *
 * Derived from the samples, not the elements, so it holds for a rotating-frame rosette as for an ellipse, and recovers the node-perpendicular axis for a Keplerian ring.
 */
export function depthGradientAxis(
  points: readonly Vector3[],
  plotScale: number,
): DepthGradientAxis | null {
  if (points.length === 0) return null;
  let lowest = points[0];
  let highest = points[0];
  for (const p of points) {
    if (p[2] < lowest[2]) lowest = p;
    if (p[2] > highest[2]) highest = p;
  }
  const spread = highest[2] - lowest[2];
  if (!(spread > 0)) return null;
  return {
    x1: lowest[0] * plotScale,
    y1: lowest[1] * plotScale,
    x2: highest[0] * plotScale,
    y2: highest[1] * plotScale,
    depthUnits: (spread / 2) * plotScale,
  };
}
