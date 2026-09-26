import type { Vector3 } from "@ksp-gonogo/sitrep-client";

/** How far a drawn thing leaves the projection's reference plane, read as colour. Depth is not inclination: a body at its ascending node has none. */

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
