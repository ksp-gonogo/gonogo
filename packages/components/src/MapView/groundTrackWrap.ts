import { degToRad, splitOnLongitudeWrap } from "@ksp-gonogo/core";

/** A ground-track sample, reduced to the two coordinates the projection tears on. */
interface GroundPoint {
  lat: number;
  lon: number;
}

/**
 * Where a ground track leaves the map, measured on what is actually DRAWN
 * rather than on what was propagated.
 *
 * An equirectangular map has two kinds of edge and the track can leave by
 * either, so this breaks the polyline on both.
 *
 * **The vertical seam.** `splitOnLongitudeWrap` breaks a polyline at the date
 * line, and it reads the sample's own longitude, which is the body-inertial one
 * the propagation produced. The canvas does not draw that: `adjustedMap`
 * rotates every longitude by the body's texture offset first, 90 degrees for
 * Kerbin, so the seam the drawing has is 90 degrees away from the seam the
 * split looks for. A track crossing the DRAWN seam is handed to the renderer as
 * one unbroken segment, and the pair of samples straddling it is stroked as a
 * single line from one edge of the map to the other. That line is horizontal,
 * full width, and sits at whatever latitude the track happened to have there.
 * It was invisible for as long as every fixture was equatorial, because a
 * spurious line along latitude zero lies exactly on top of the track that drew
 * it. `kerbin-plane-change-node` is inclined 28 degrees and drew it plainly.
 *
 * **The poles**, which are the top and bottom edges. A craft passing over one
 * genuinely inverts its longitude, so the two samples either side of the
 * crossing sit at opposite ends of the map and get stroked as one line along
 * the edge. `mun-polar-orbit` jumps 179.97 degrees between latitudes -89.10 and
 * -89.62, which is a whisker under the seam threshold and drew a dashed bar
 * across a third of the bottom of the map, joining two passes that never meet
 * there. See `splitOnPoleCrossing` for how a pole crossing is told from a seam
 * one, which is not by lowering that threshold.
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
 * Break the polyline wherever the craft flew over a pole.
 *
 * The signature is geometric, not a tuned constant: a pair straddles a pole
 * when the shorter great-circle path between the two samples passes closer to
 * that pole than the samples are to each other. Both halves are needed, and
 * both are real properties of the track rather than of the map.
 *
 * *Passes the pole* rules out an ordinary pair climbing towards one: the
 * closest point of their arc to the pole has to lie BETWEEN them, which for a
 * pair on the same leg it does not. On an exactly polar orbit every pair's
 * great circle contains the pole, so this is the half that does the work there.
 *
 * *Closer than they are to each other* is what makes the tear a tear. A track
 * that misses the pole by more than one sample step draws a small jog at its
 * highest latitude and the straight line between the samples is honest; a track
 * that passes nearer than the sampling can resolve draws a line the craft never
 * flew. Tying the test to the sample spacing means it scales with the sampling
 * rather than needing a latitude band picked to suit one fixture.
 *
 * **What gets drawn instead is a break, not a join over the edge.** On an
 * equirectangular map the pole is not a point, it is the whole top or bottom
 * edge, so any polyline continuing across it has to run ALONG that edge, which
 * is the artefact being removed. Joining the passes honestly would also mean
 * inventing samples at latitude +/-90 with no time, altitude or patch of their
 * own. So each pass runs down to within a fraction of a degree of the edge and
 * stops, which is what the craft does.
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

  // Angular distance from the pole axis to the arc's great circle. The normal's
  // z component IS the sine of it, both being measured off the same axis.
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
