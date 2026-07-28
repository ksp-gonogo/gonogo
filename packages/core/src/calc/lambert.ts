/**
 * Lambert's problem: the two-point boundary-value solve at the heart of a
 * porkchop plot: given a departure position `r1`, an arrival position `r2`,
 * a time of flight `tof`, and the central body's `mu`, find the transfer
 * orbit's departure and arrival velocity vectors.
 *
 * Universal-variable (Stumpff) formulation, Curtis "Orbital Mechanics for
 * Engineering Students" Algorithm 5.2 (equivalently Bate/Mueller/White,
 * Vallado). Single-revolution, prograde by default. Works in any consistent
 * unit system (SI metres/seconds, or km: μ must match); the porkchop feeds it
 * SI state vectors from `kepler.ts`'s `solve`.
 *
 * Inclination-aware by construction: it operates on full 3D position vectors,
 * so a transfer between inclined orbits (RSS-relevant) yields the true
 * out-of-plane velocity, not a coplanar approximation.
 *
 * Pure and deterministic. Returns `null` for a non-convergent or degenerate
 * geometry (notably an exactly-180° transfer, where the transfer plane is
 * undefined) rather than throwing: a porkchop grid simply skips those cells.
 */

export type Vec3Tuple = readonly [x: number, y: number, z: number];

export interface LambertResult {
  /** Departure velocity on the transfer orbit (parent-relative). */
  v1: Vec3Tuple;
  /** Arrival velocity on the transfer orbit (parent-relative). */
  v2: Vec3Tuple;
}

const dot = (a: Vec3Tuple, b: Vec3Tuple): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mag = (a: Vec3Tuple): number => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Stumpff C(z). */
function stumpffC(z: number): number {
  if (z > 0) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < 0) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5;
}

/** Stumpff S(z). */
function stumpffS(z: number): number {
  if (z > 0) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / s ** 3;
  }
  if (z < 0) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / s ** 3;
  }
  return 1 / 6;
}

const MAX_ITERS = 60;
const TOL = 1e-8;

/**
 * Solve Lambert's problem. `prograde` selects the transfer direction (the sign
 * of the swept angle Δθ). Returns `null` if the geometry is degenerate or the
 * Newton iteration fails to converge.
 *
 * `shortWay` forces the ≤180° arc regardless of the bodies' angular separation.
 * The default (`false`) picks the swept angle from the prograde/retrograde
 * direction, which for a target more than 180° ahead takes the "long way"
 * (Δθ>180°, a Type-II transfer): a valid but high-energy arc whose
 * universal-variable solve is ill-conditioned for large reflex angles. A
 * porkchop planner wants a single coherent lobe of the sensible short transfers,
 * so it forces short-way: the field stays continuous (A≥0, well-conditioned)
 * and contours to one clean bowl instead of two lobes split by a divergent ridge.
 */
export function solveLambert(
  r1v: Vec3Tuple,
  r2v: Vec3Tuple,
  tof: number,
  mu: number,
  prograde = true,
  shortWay = false,
): LambertResult | null {
  if (!(tof > 0) || !(mu > 0)) return null;

  const r1 = mag(r1v);
  const r2 = mag(r2v);
  if (r1 === 0 || r2 === 0) return null;

  const c = cross(r1v, r2v);
  let cosDtheta = dot(r1v, r2v) / (r1 * r2);
  cosDtheta = Math.max(-1, Math.min(1, cosDtheta));

  // Swept angle Δθ. Short-way forces the ≤180° arc; otherwise the branch is
  // chosen by prograde/retrograde via the sign of the transfer-normal
  // z-component (Curtis Alg 5.2), which may take the >180° long way.
  let dtheta = Math.acos(cosDtheta);
  const zComp = c[2];
  if (!shortWay) {
    if (prograde) {
      if (zComp < 0) dtheta = 2 * Math.PI - dtheta;
    } else {
      if (zComp >= 0) dtheta = 2 * Math.PI - dtheta;
    }
  }

  const sinDtheta = Math.sin(dtheta);
  // A → 0 at Δθ = 0 or π: transfer plane undefined, no single-rev solution.
  if (Math.abs(sinDtheta) < 1e-12) return null;
  const A = sinDtheta * Math.sqrt((r1 * r2) / (1 - cosDtheta));
  if (!Number.isFinite(A) || A === 0) return null;

  const yOf = (z: number): number => {
    const C = stumpffC(z);
    return r1 + r2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(C);
  };

  // Time of flight as a function of the universal variable z. Monotonically
  // increasing in z where defined (y>0), and NaN where y≤0. This is the
  // constraint we invert: find z with tofAt(z) = tof.
  const sqrtMu = Math.sqrt(mu);
  const tofAt = (z: number): number => {
    const C = stumpffC(z);
    if (!(C > 0)) return Number.NaN;
    const y = yOf(z);
    if (!(y > 0)) return Number.NaN;
    return ((y / C) ** 1.5 * stumpffS(z) + A * Math.sqrt(y)) / sqrtMu;
  };

  // Bracket the root, then bisect. A globally convergent solve (unlike a
  // Newton iteration from z=0, which diverges for the large reflex swept
  // angles of long-way / Type-II transfers). Single-revolution: z is bounded
  // above by (2π)²; below it runs negative (hyperbolic transfer arcs). Scan for
  // the first sub-interval where tofAt crosses `tof` from below.
  const Z_MAX = 4 * Math.PI * Math.PI - 1e-6;
  const Z_MIN = -4 * Math.PI * Math.PI;
  const SCAN_STEPS = 200;
  let zLo = Number.NaN;
  let zHi = Number.NaN;
  let prevZ = Number.NaN;
  let prevG = Number.NaN;
  for (let k = 0; k <= SCAN_STEPS; k++) {
    const zk = Z_MIN + ((Z_MAX - Z_MIN) * k) / SCAN_STEPS;
    const t = tofAt(zk);
    const g = Number.isFinite(t) ? t - tof : Number.NaN;
    if (Number.isFinite(g) && Number.isFinite(prevG) && prevG <= 0 && g >= 0) {
      zLo = prevZ;
      zHi = zk;
      break;
    }
    prevZ = zk;
    prevG = g;
  }
  // No sign change → the requested tof is outside the single-rev range for this
  // geometry (no solution). A porkchop simply skips the cell.
  if (Number.isNaN(zLo)) return null;

  let z = (zLo + zHi) / 2;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    z = (zLo + zHi) / 2;
    const t = tofAt(z);
    if (!Number.isFinite(t)) {
      // Stepped into a y≤0 gap; pull the bound in from the NaN side.
      zLo = z;
      continue;
    }
    if (Math.abs(t - tof) <= tof * TOL) break;
    if (t < tof) zLo = z;
    else zHi = z;
    if (zHi - zLo < 1e-12) break;
  }

  const y = yOf(z);
  if (!(y > 0) || !Number.isFinite(y)) return null;

  // Lagrange coefficients → the two velocity vectors.
  const f = 1 - y / r1;
  const g = A * Math.sqrt(y / mu);
  const gDot = 1 - y / r2;
  if (g === 0) return null;

  const v1: Vec3Tuple = [
    (r2v[0] - f * r1v[0]) / g,
    (r2v[1] - f * r1v[1]) / g,
    (r2v[2] - f * r1v[2]) / g,
  ];
  const v2: Vec3Tuple = [
    (gDot * r2v[0] - r1v[0]) / g,
    (gDot * r2v[1] - r1v[1]) / g,
    (gDot * r2v[2] - r1v[2]) / g,
  ];

  for (const c2 of [...v1, ...v2]) if (!Number.isFinite(c2)) return null;
  return { v1, v2 };
}

/**
 * Total impulsive Δv for a porkchop cell: the departure hyperbolic-excess
 * magnitude |v1 − vDeparture| plus the arrival excess |v2 − vArrival|, where
 * `vDeparture`/`vArrival` are the origin/destination bodies' own velocities at
 * the respective UTs. (This is the "characteristic" Δv the porkchop colours by;
 * it excludes the parking-orbit-specific Oberth discount, which the ejection
 * readout accounts for separately.)
 */
export function lambertDeltaV(
  sol: LambertResult,
  vDeparture: Vec3Tuple,
  vArrival: Vec3Tuple,
): number {
  const dep = Math.hypot(
    sol.v1[0] - vDeparture[0],
    sol.v1[1] - vDeparture[1],
    sol.v1[2] - vDeparture[2],
  );
  const arr = Math.hypot(
    sol.v2[0] - vArrival[0],
    sol.v2[1] - vArrival[1],
    sol.v2[2] - vArrival[2],
  );
  return dep + arr;
}
