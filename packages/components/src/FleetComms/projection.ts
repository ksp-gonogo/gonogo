import { orbitalToCartesian, trueAnomalyToRadius } from "@ksp-gonogo/core";

/**
 * Minimal orbit-shape input `projectOrbitPosition` needs — a subset of
 * `SystemDiagram`'s own `VesselOrbit`, degrees throughout (matching the wire
 * convention `SystemView/index.tsx` already normalises vessel.orbit to
 * before handing it to the diagram).
 */
export interface ProjectableOrbit {
  /** Semi-major axis, metres. */
  sma: number;
  /** Eccentricity (0 = circle, 0 <= e < 1 = ellipse). */
  ecc: number;
  /** Longitude of the ascending node, degrees. */
  lan: number;
  /** Argument of periapsis, degrees. */
  argPe: number;
  /** True anomaly, degrees. */
  trueAnomalyDeg: number;
}

/**
 * Parent-centric SVG-space position of a body/vessel on its orbit — the
 * exact geometry `SystemDiagram.tsx`'s private `bodyPosition` uses (polar
 * radius at the given true anomaly, rotated by `lan + argPe` so periapsis
 * sits on the local +x axis before rotation, parent at the origin/focus).
 * Composed from `@ksp-gonogo/core`'s already-public `trueAnomalyToRadius`/
 * `orbitalToCartesian` rather than re-deriving the polar-radius formula, so
 * this stays a thin rotation wrapper, not a second implementation of the
 * conic-section math. `SystemDiagram.tsx` is intentionally left untouched
 * (the host stays unchanged) — this lives beside the augment that needs it.
 *
 * `scale` is the diagram's metres -> SVG-user-unit `plotScale` (from
 * `SystemOverlayContext`); apply it to the radius BEFORE rotating, matching
 * `bodyPosition`'s own order of operations.
 */
export function projectOrbitPosition(
  orbit: ProjectableOrbit,
  scale: number,
): { x: number; y: number } {
  const ecc = Math.min(Math.max(orbit.ecc, 0), 0.999);
  const radius =
    trueAnomalyToRadius(orbit.sma, ecc, orbit.trueAnomalyDeg) * scale;
  const local = orbitalToCartesian(radius, orbit.trueAnomalyDeg);
  const phi = ((orbit.lan + orbit.argPe) * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  return {
    x: local.x * cosPhi - local.y * sinPhi,
    y: local.x * sinPhi + local.y * cosPhi,
  };
}
