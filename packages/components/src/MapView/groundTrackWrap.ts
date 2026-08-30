import { splitOnLongitudeWrap } from "@ksp-gonogo/core";

/**
 * Where a ground track leaves one edge of the map and re-enters at the other,
 * measured on the longitude actually DRAWN rather than the one propagated.
 *
 * `splitOnLongitudeWrap` breaks a polyline at the date line, and it reads the
 * sample's own longitude, which is the body-inertial one the propagation
 * produced. The canvas does not draw that: `adjustedMap` rotates every
 * longitude by the body's texture offset first, 90 degrees for Kerbin, so the
 * seam the drawing has is 90 degrees away from the seam the split looks for. A
 * track crossing the DRAWN seam is handed to the renderer as one unbroken
 * segment, and the pair of samples straddling it is stroked as a single line
 * from one edge of the map to the other.
 *
 * That line is horizontal, full width, and sits at whatever latitude the track
 * happened to have there. It was invisible for as long as every fixture was
 * equatorial, because a spurious line along latitude zero lies exactly on top
 * of the track that drew it. `kerbin-plane-change-node` is inclined 28 degrees
 * and drew it plainly.
 */
export function splitOnDrawnLongitudeWrap<T extends { lon: number }>(
  samples: readonly T[],
  longitudeOffsetDeg: number,
): T[][] {
  return splitOnLongitudeWrap(samples, 180, (sample) =>
    drawnLongitude(sample.lon, longitudeOffsetDeg),
  );
}

/** The same rotate-and-wrap `adjustedMap` applies before projecting. */
function drawnLongitude(lon: number, offsetDeg: number): number {
  return ((((lon + offsetDeg + 180) % 360) + 360) % 360) - 180;
}
