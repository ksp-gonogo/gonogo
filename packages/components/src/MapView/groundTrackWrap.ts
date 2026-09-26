import { degToRad, splitOnLongitudeWrap } from "@ksp-gonogo/core";

/** A ground-track sample, reduced to the two coordinates the projection tears on. */
interface GroundPoint {
  lat: number;
  lon: number;
}

/**
 * Where a ground track leaves the map, measured on what is drawn rather than
 * what was propagated, breaking the polyline at both kinds of edge.
 *
 * The vertical seam: `adjustedMap` rotates every longitude by the body's
 * texture offset (90 degrees for Kerbin), so the drawn seam is not the
 * body-inertial one, and a track crossing it would be stroked as one
 * full-width horizontal line. The poles: a craft passing over one inverts its
 * longitude, and the pair either side would be stroked along the map edge.
 */
export function splitOnDrawnLongitudeWrap<T extends GroundPoint>(
  samples: readonly T[],
  longitudeOffsetDeg: number,
): T[][] {
  const seamSegments = splitOnLongitudeWrap(samples, 180, (sample) =>
    drawnLongitude(sample.lon, longitudeOffsetDeg),
  );
  return seamSegments.flatMap(splitOnPoleCrossing);
}

/** The same rotate-and-wrap `adjustedMap` applies before projecting. */
function drawnLongitude(lon: number, offsetDeg: number): number {
  return ((((lon + offsetDeg + 180) % 360) + 360) % 360) - 180;
}

/**
 * Break the polyline wherever the craft flew over a pole. Geometric, not a
 * tuned constant: a pair straddles a pole when the shorter great-circle arc
 * between them passes closer to it than the samples are to each other.
 * "Passes" means the arc's closest point to the pole lies between them, which
 * rules out a pair climbing on one leg; "closer than each other" ties the test
 * to the sampling, so a near miss the sampling resolves still draws its jog.
 * The result is a break, not a join: on this projection the pole is the whole
 * edge, and a join would run along it.
 */
function splitOnPoleCrossing<T extends GroundPoint>(
  samples: readonly T[],
): T[][] {
  if (samples.length === 0) return [];
  const segments: T[][] = [[samples[0]]];
  for (let i = 1; i < samples.length; i++) {
    if (crossesAPole(samples[i - 1], samples[i])) segments.push([samples[i]]);
    else segments[segments.length - 1].push(samples[i]);
  }
  return segments;
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
  const phi = degToRad(lat);
  const lambda = degToRad(lon);
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
