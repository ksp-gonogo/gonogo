import type { Vec3Tuple } from "./kepler";

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Returns how far `to` leads `from` about their common centre, in degrees in
 * (-180, 180]: positive when `to` is ahead in the direction `from` is moving.
 *
 * Both are positions relative to that centre, in metres. The angle is measured
 * in the plane of `from`'s own motion (its position crossed with its velocity),
 * with `to` projected onto it, so it is the true angle between the two position
 * vectors and agrees with a difference of longitudes only when the orbits are
 * coplanar. Null when `from` has no motion to give a plane, or either position
 * is the centre itself.
 *
 * @category Frames of reference
 */
export function phaseAngleBetween(
  from: { position: Vec3Tuple; velocity: Vec3Tuple },
  toPosition: Vec3Tuple,
): number | null {
  const normal = cross(from.position, from.velocity);
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(normalLength > 0)) return null;
  const n: Vec3Tuple = [
    normal[0] / normalLength,
    normal[1] / normalLength,
    normal[2] / normalLength,
  ];
  const lift = dot(toPosition, n);
  const inPlane: Vec3Tuple = [
    toPosition[0] - lift * n[0],
    toPosition[1] - lift * n[1],
    toPosition[2] - lift * n[2],
  ];
  const along = dot(from.position, inPlane);
  const across = dot(cross(from.position, inPlane), n);
  if (along === 0 && across === 0) return null;
  const deg = (Math.atan2(across, along) * 180) / Math.PI;
  return deg <= -180 ? deg + 360 : deg;
}
