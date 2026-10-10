/** The ground-track strip the mod sends on `vessel.landing`, as points the plots draw from. */

/** The ground track as points, or null when it cannot be drawn honestly (absent, mismatched, short, non-finite, or out of order). */
export function groundPoints(
  distances: readonly number[] | null,
  elevations: readonly number[] | null,
): { x: number; y: number }[] | null {
  if (!distances || !elevations) return null;
  if (distances.length < 2 || distances.length !== elevations.length) {
    return null;
  }
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i];
    const e = elevations[i];
    if (!Number.isFinite(d) || !Number.isFinite(e)) return null;
    if (i > 0 && d <= distances[i - 1]) return null;
    points.push({ x: d, y: e });
  }
  return points;
}

/** Elevation at `x` along the strip, interpolated between its samples and held at its ends. */
export function elevationAt(
  points: readonly { x: number; y: number }[],
  x: number,
) {
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x >= x) {
      const a = points[i - 1];
      const b = points[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return last.y;
}
