import type { ProjectedOrbit } from "../shared/OrbitDiagram";

/**
 * Where the two conics are furthest apart, and by how much. Sampled, because
 * the far apsis is the widest point only for a burn made at an apsis. Each
 * radius is taken against its own argument of periapsis, since a burn rotates
 * the apsides. Null when either conic is unbounded or they never separate.
 */
export function widestSeparation(
  current: { sma: number; ecc: number; argPe: number },
  planned: ProjectedOrbit,
): { x: number; y: number; gap: number } | null {
  if (current.ecc >= 1 || current.sma <= 0) return null;
  if (planned.ecc >= 1 || planned.sma <= 0) return null;

  const plannedArgPe = planned.argPe ?? current.argPe;
  const radiusAt = (
    sma: number,
    ecc: number,
    argPeDeg: number,
    nuDeg: number,
  ): number => {
    const trueFromPe = ((nuDeg - argPeDeg) * Math.PI) / 180;
    return (sma * (1 - ecc * ecc)) / (1 + ecc * Math.cos(trueFromPe));
  };

  let bestNu = 0;
  let bestGap = 0;
  for (let nu = 0; nu < 360; nu += 0.5) {
    const a = radiusAt(current.sma, current.ecc, current.argPe, nu);
    const b = radiusAt(planned.sma, planned.ecc, plannedArgPe, nu);
    const gap = Math.abs(a - b);
    if (gap > bestGap) {
      bestGap = gap;
      bestNu = nu;
    }
  }
  if (!(bestGap > 0)) return null;

  // On the flown curve at that bearing, and in the diagram's own frame, whose rotation is the negative of the angle.
  const r = radiusAt(current.sma, current.ecc, current.argPe, bestNu);
  const theta = (-bestNu * Math.PI) / 180;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), gap: bestGap };
}
