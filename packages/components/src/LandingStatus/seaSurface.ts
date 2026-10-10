/**
 * What the plots' open water needs from the body: where a point stands on it, so the sea's waves stay put on the body as a window moves, and the gravity that sets how fast they run.
 */

/** Metres east and north of the body's own origin, at a latitude and longitude in degrees on a body of this radius. */
export function surfaceMeters(
  latDeg: number,
  lonDeg: number,
  radiusMeters: number,
): { east: number; north: number } {
  const rad = Math.PI / 180;
  return {
    east: lonDeg * rad * radiusMeters * Math.cos(latDeg * rad),
    north: latDeg * rad * radiusMeters,
  };
}

/** The body's surface gravity, m/s squared: the stream's own figure, else its gravitational parameter over its radius squared; null when neither is known. */
export function surfaceGravityOf(body: {
  radius: number;
  gm?: number;
  surfaceGravity?: number;
}): number | null {
  if (body.surfaceGravity != null && body.surfaceGravity > 0) {
    return body.surfaceGravity;
  }
  if (body.gm != null && body.gm > 0 && body.radius > 0) {
    return body.gm / body.radius ** 2;
  }
  return null;
}
