/**
 * Great-circle distance + initial bearing between two lat/lon points on a
 * sphere of the given radius. Used for the reticle's drift vector (how far
 * downrange, and in which compass direction, the sampled touchdown site is from
 * directly below the vessel).
 */

export interface GreatCircle {
  /** Surface distance, metres. */
  distanceMeters: number;
  /** Initial bearing, degrees clockwise from north (0–360). */
  bearingDeg: number;
}

const DEG = Math.PI / 180;

export function greatCircle(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radiusMeters: number,
): GreatCircle {
  const phi1 = lat1 * DEG;
  const phi2 = lat2 * DEG;
  const dPhi = (lat2 - lat1) * DEG;
  const dLambda = (lon2 - lon1) * DEG;

  // Haversine: numerically stable for small distances (acos loses precision
  // near 1, which matters when the site is nearly directly below the vessel).
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const distanceMeters =
    radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  let bearingDeg = Math.atan2(y, x) / DEG;
  bearingDeg = ((bearingDeg % 360) + 360) % 360;

  return { distanceMeters, bearingDeg };
}
