import {
  dot,
  type Elements,
  norm,
  orbitPoints,
  phaseAngle,
  planeBasis,
  relativeInclination,
  relativeInTargetFrame,
  relativeTrack,
  stateAt,
  type Vec3,
} from "./kepler";

export type Point2 = readonly [number, number];

/** The closest approach the provider reports: when and how near, plain numbers. */
export interface Approach {
  /** Universal time of the minimum separation, seconds. */
  time: number;
  /** The separation then, metres. */
  distance: number;
}

/** What the Far and Approach circles of a craft or port target are drawn from. */
export interface CraftGeometry {
  /** Both orbits and both craft projected into the target's orbital plane, metres, with the body at the origin. */
  plane: {
    chaserOrbit: Point2[];
    targetOrbit: Point2[];
    chaser: Point2;
    target: Point2;
    /** Where the target will be at closest approach, when the provider reports one. */
    targetAtApproach: Point2 | null;
  };
  /** Whether the two orbit lines are far enough apart to draw as two. */
  apart: boolean;
  bodyRadius: number | undefined;
  /** The target's distance from the body's centre, metres. */
  targetRadius: number;
  /** The angle at the body from you to the target, degrees. */
  phase: number | null;
  relativeInclination: number | null;
  /** You relative to the target, in the target's frame: x outward, y along its track, z along its normal. */
  relative: Vec3;
  range: number;
  /** Your predicted track relative to the target up to the closest approach. */
  track: Vec3[] | null;
  /** The closest-approach point in the same frame. */
  approachRelative: Vec3 | null;
  approach: Approach | null;
}

/** The largest gap between two orbit lines, as a share of the larger orbit's radius, above which they read as two. */
export const APART_SHARE = 0.03;
/** How far ahead the predicted track runs when no closest approach is reported, seconds. */
const DEFAULT_HORIZON_S = 600;
const MAX_HORIZON_S = 900;
const MIN_HORIZON_S = 5;

function project(points: readonly Vec3[], e1: Vec3, e2: Vec3): Point2[] {
  return points.map((p) => [dot(p, e1), dot(p, e2)] as const);
}

/** The largest distance from a point of `a` to the nearest point of `b`, over the larger radius of the two. */
export function orbitSpread(
  a: readonly Point2[],
  b: readonly Point2[],
): number {
  let worst = 0;
  let radius = 0;
  for (const p of a) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const q of b)
      nearest = Math.min(nearest, Math.hypot(p[0] - q[0], p[1] - q[1]));
    worst = Math.max(worst, nearest);
    radius = Math.max(radius, Math.hypot(p[0], p[1]));
  }
  for (const q of b) radius = Math.max(radius, Math.hypot(q[0], q[1]));
  return radius === 0 ? 0 : worst / radius;
}

/**
 * Everything the craft circles need from the two craft's elements at one
 * instant. Null where either is on an open conic, so a hyperbolic escape draws
 * nothing rather than a wrong curve.
 */
export function craftGeometry(input: {
  chaser: Elements;
  target: Elements;
  ut: number;
  approach?: Approach | null;
  bodyRadius?: number;
}): CraftGeometry | null {
  const { chaser, target, ut } = input;
  const c = stateAt(chaser, ut);
  const t = stateAt(target, ut);
  const relative = relativeInTargetFrame(chaser, target, ut);
  if (c === null || t === null || relative === null) return null;
  const { e1, e2 } = planeBasis(target);
  const chaserOrbit = project(orbitPoints(chaser, 120), e1, e2);
  const targetOrbit = project(orbitPoints(target, 120), e1, e2);
  const approach = input.approach ?? null;
  const approachAhead =
    approach !== null && Number.isFinite(approach.time) && approach.time > ut
      ? approach
      : null;
  const targetAtApproach = approachAhead
    ? stateAt(target, approachAhead.time)
    : null;
  const horizon = approachAhead
    ? Math.min(Math.max(approachAhead.time - ut, MIN_HORIZON_S), MAX_HORIZON_S)
    : DEFAULT_HORIZON_S;
  return {
    plane: {
      chaserOrbit,
      targetOrbit,
      chaser: [dot(c.r, e1), dot(c.r, e2)],
      target: [dot(t.r, e1), dot(t.r, e2)],
      targetAtApproach: targetAtApproach
        ? [dot(targetAtApproach.r, e1), dot(targetAtApproach.r, e2)]
        : null,
    },
    apart: orbitSpread(chaserOrbit, targetOrbit) > APART_SHARE,
    bodyRadius: input.bodyRadius,
    targetRadius: norm(t.r),
    phase: phaseAngle(chaser, target, ut),
    relativeInclination: relativeInclination(chaser, target, ut),
    relative,
    range: norm(relative),
    track: relativeTrack(chaser, target, ut, horizon, 60),
    approachRelative: approachAhead
      ? relativeInTargetFrame(chaser, target, approachAhead.time)
      : null,
    approach: approachAhead,
  };
}
