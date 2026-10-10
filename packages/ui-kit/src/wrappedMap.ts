/**
 * Geometry for a flat map that repeats east and west: a ground track drawn as
 * one continuous line however often it crosses the antimeridian, and every
 * mark drawn in whichever copy of the world is in view.
 */

/** A point on the body, in degrees. */
export interface GroundPoint {
  /** Degrees north, from -90 at the south pole to 90 at the north. */
  lat: number;
  /** Degrees east. */
  lon: number;
}

/**
 * Break a ground track wherever it flies over a pole, where its longitude
 * flips by half a turn and a line joining the pair would run along the map's
 * top or bottom edge. Crossing the antimeridian is not a break: draw each run
 * with {@link wrapPath}, which carries it on into the next copy of the world.
 *
 * Geometric, not a tuned constant: a pair straddles a pole when the shorter
 * great-circle arc between them passes closer to it than the samples are to
 * each other. "Passes" means the arc's closest point to the pole lies between
 * them, which rules out a pair climbing on one leg; "closer than each other"
 * ties the test to the sampling, so a near miss the sampling resolves still
 * draws its jog.
 */
export function splitAtPoleCrossings<Point extends GroundPoint>(
  points: readonly Point[],
): Point[][] {
  if (points.length === 0) return [];
  const runs: Point[][] = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    if (crossesAPole(points[i - 1], points[i])) runs.push([points[i]]);
    else runs[runs.length - 1].push(points[i]);
  }
  return runs;
}

/**
 * The copies of a projected path that cross a view of a map repeating every
 * `period` pixels across. The path is first made continuous, each point moved
 * by whole periods to lie within half a period of the one before, so a track
 * that leaves one edge of the world carries on past it rather than jumping
 * back across the map. Then it is shifted by every whole period that brings
 * some of it between `viewMin` and `viewMax`.
 *
 * Points may come from any copy of the world, such as a projection that wraps
 * longitude. The path must already be split where it crosses a pole (see
 * {@link splitAtPoleCrossings}), since half a turn of longitude is no jump a
 * continuous line can be told apart from.
 */
export function wrapPath<Point extends { x: number }>(
  points: readonly Point[],
  period: number,
  viewMin: number,
  viewMax: number,
): Point[][] {
  if (points.length === 0 || !(period > 0)) return [];
  const xs: number[] = [points[0].x];
  let min = xs[0];
  let max = xs[0];
  for (let i = 1; i < points.length; i++) {
    const previous = xs[i - 1];
    const x = previous + wrapToHalfPeriod(points[i].x - previous, period);
    xs.push(x);
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return repeatsInView(min, max, viewMin, viewMax, period).map((shift) =>
    points.map((point, i) => ({ ...point, x: xs[i] + shift })),
  );
}

/**
 * Every whole multiple of `period` that, added to the span `min` to `max`,
 * puts some of it between `viewMin` and `viewMax`, west to east. On a
 * map repeating every `period` pixels, these are the shifts at which to draw
 * a mark or a region so it appears in every copy of the world in view. A
 * single point is a span with `min` equal to `max`; widen the view by the
 * mark's own size so one straddling the edge is not dropped.
 */
export function repeatsInView(
  min: number,
  max: number,
  viewMin: number,
  viewMax: number,
  period: number,
): number[] {
  if (!(period > 0) || !Number.isFinite(min) || !Number.isFinite(max))
    return [];
  const first = Math.ceil((viewMin - max) / period);
  const last = Math.floor((viewMax - min) / period);
  const shifts: number[] = [];
  // Adding zero turns the -0 of a negative k times zero into 0.
  for (let k = first; k <= last; k++) shifts.push(k * period + 0);
  return shifts;
}

/** `delta` moved by whole periods into the half-open range from minus half a period to plus half. */
function wrapToHalfPeriod(delta: number, period: number): number {
  const half = period / 2;
  return ((((delta + half) % period) + period) % period) - half;
}

type Vec3 = readonly [number, number, number];

function crossesAPole(a: GroundPoint, b: GroundPoint): boolean {
  const u = unitVector(a);
  const v = unitVector(b);
  const separation = angleBetween(u, v);
  if (separation === 0) return false;

  const normal = normalise(cross(u, v));
  // Coincident or antipodal samples span no unique great circle.
  if (normal === null) return false;

  // Angular distance from the pole axis to the arc's great circle: the normal's z is its sine.
  const missDistance = Math.asin(Math.min(1, Math.abs(normal[2])));
  if (missDistance >= separation) return false;

  // The nearer pole, and the point of the great circle closest to it.
  const pole: Vec3 = [0, 0, a.lat + b.lat >= 0 ? 1 : -1];
  const closest = normalise(subtractProjection(pole, normal));
  if (closest === null) return false;

  // On the minor arc iff nearer to each end than the ends are to each other.
  const span = dot(u, v);
  return dot(u, closest) > span && dot(v, closest) > span;
}

function unitVector({ lat, lon }: GroundPoint): Vec3 {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const c = Math.cos(phi);
  return [c * Math.cos(lambda), c * Math.sin(lambda), Math.sin(phi)];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

/** `v` with its component along the unit vector `n` removed. */
function subtractProjection(v: Vec3, n: Vec3): Vec3 {
  const k = dot(v, n);
  return [v[0] - k * n[0], v[1] - k * n[1], v[2] - k * n[2]];
}

/** `null` rather than a NaN-laden vector when there is no direction to return. */
function normalise(v: Vec3): Vec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < 1e-12) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}
