import {
  type OrbitElements,
  solveAnomalies,
} from "@ksp-gonogo/sitrep-sdk/spine";

/**
 * Seconds from `ut` until the craft's own conic next reaches the surface of the
 * body it orbits, or `null` when it never does: a periapsis above the surface,
 * a craft already at or under it, an open orbit whose periapsis is behind it, or
 * elements the solver cannot read. Vacuum and sea level, so a body's air and its
 * terrain do not move the figure.
 *
 * Useful for warning the operator that a craft coasting on a path that dips
 * below the surface will hit it, whatever its height above terrain or vertical
 * speed read now. Used by the Landing Status widget.
 */
export function orbitImpactSeconds(
  orbit: OrbitElements,
  bodyRadius: number,
  ut: number,
): number | null {
  const { ecc } = orbit;
  if (!(bodyRadius > 0) || !(ecc > 0) || ecc === 1) return null;
  const open = ecc > 1;
  const sma = Math.abs(orbit.sma);
  const periapsis = open ? sma * (ecc - 1) : sma * (1 - ecc);
  if (!Number.isFinite(periapsis) || periapsis >= bodyRadius) return null;

  const now = solveAnomalies(orbit, ut);
  const radiusNow = open
    ? (sma * (ecc * ecc - 1)) / (1 + ecc * Math.cos(now.trueAnomaly))
    : (sma * (1 - ecc * ecc)) / (1 + ecc * Math.cos(now.trueAnomaly));
  if (!(radiusNow > bodyRadius)) return null;

  const semiLatus = open ? sma * (ecc * ecc - 1) : sma * (1 - ecc * ecc);
  const cosImpact = (semiLatus / bodyRadius - 1) / ecc;
  if (!(Math.abs(cosImpact) <= 1)) return null;
  // The inbound crossing, before periapsis.
  const trueAnomaly = -Math.acos(cosImpact);

  const half = trueAnomaly / 2;
  let meanAtImpact: number;
  if (open) {
    const hyperbolic =
      2 * Math.atanh(Math.sqrt((ecc - 1) / (ecc + 1)) * Math.tan(half));
    meanAtImpact = ecc * Math.sinh(hyperbolic) - hyperbolic;
  } else {
    const eccentric =
      2 *
      Math.atan2(
        Math.sqrt(1 - ecc) * Math.sin(half),
        Math.sqrt(1 + ecc) * Math.cos(half),
      );
    meanAtImpact = eccentric - ecc * Math.sin(eccentric);
  }

  let sweep = meanAtImpact - now.meanAnomaly;
  if (open) {
    // The craft is already past the inbound crossing but not at the surface: it is inside the body's path of no return.
    if (sweep <= 0) return null;
  } else {
    const turn = 2 * Math.PI;
    sweep = ((sweep % turn) + turn) % turn;
  }
  const seconds = sweep / now.meanMotion;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
