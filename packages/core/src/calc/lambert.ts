/**
 * Lambert's problem — the two-point boundary-value solve at the heart of a
 * porkchop plot: given a departure position `r1`, an arrival position `r2`,
 * a time of flight `tof`, and the central body's `mu`, find the transfer
 * orbit's departure and arrival velocity vectors.
 *
 * Universal-variable (Stumpff) formulation, Curtis "Orbital Mechanics for
 * Engineering Students" Algorithm 5.2 (equivalently Bate/Mueller/White,
 * Vallado). Single-revolution, prograde by default. Works in any consistent
 * unit system (SI metres/seconds, or km — μ must match); the porkchop feeds it
 * SI state vectors from `kepler.ts`'s `solve`.
 *
 * Inclination-aware by construction: it operates on full 3D position vectors,
 * so a transfer between inclined orbits (RSS-relevant) yields the true
 * out-of-plane velocity, not a coplanar approximation.
 *
 * Pure and deterministic. Returns `null` for a non-convergent or degenerate
 * geometry (notably an exactly-180° transfer, where the transfer plane is
 * undefined) rather than throwing — a porkchop grid simply skips those cells.
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
 */
export function solveLambert(
  r1v: Vec3Tuple,
  r2v: Vec3Tuple,
  tof: number,
  mu: number,
  prograde = true,
): LambertResult | null {
  if (!(tof > 0) || !(mu > 0)) return null;

  const r1 = mag(r1v);
  const r2 = mag(r2v);
  if (r1 === 0 || r2 === 0) return null;

  const c = cross(r1v, r2v);
  let cosDtheta = dot(r1v, r2v) / (r1 * r2);
  cosDtheta = Math.max(-1, Math.min(1, cosDtheta));

  // Swept angle Δθ in [0, 2π), branch chosen by prograde/retrograde via the
  // sign of the transfer-normal z-component (Curtis Alg 5.2).
  let dtheta = Math.acos(cosDtheta);
  const zComp = c[2];
  if (prograde) {
    if (zComp < 0) dtheta = 2 * Math.PI - dtheta;
  } else {
    if (zComp >= 0) dtheta = 2 * Math.PI - dtheta;
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

  // F(z) = 0 is the time-of-flight constraint. Newton-Raphson from z=0.
  let z = 0;
  const sqrtMu = Math.sqrt(mu);
  let iter = 0;
  for (; iter < MAX_ITERS; iter++) {
    const C = stumpffC(z);
    const S = stumpffS(z);
    const y = yOf(z);
    if (!(y > 0)) {
      // y must stay positive; nudge z up and retry (Curtis's guard).
      z += 0.1;
      continue;
    }
    const sqrtY = Math.sqrt(y);
    const F = (y / C) ** 1.5 * S + A * sqrtY - sqrtMu * tof;

    // dF/dz (Curtis Eq. 5.43), with the z=0 special case.
    let dF: number;
    if (Math.abs(z) < 1e-12) {
      const y0 = yOf(0);
      dF =
        (Math.SQRT2 / 40) * y0 ** 1.5 +
        (A / 8) * (Math.sqrt(y0) + A * Math.sqrt(1 / (2 * y0)));
    } else {
      dF =
        (y / C) ** 1.5 *
          ((1 / (2 * z)) * (C - (3 * S) / (2 * C)) + (3 * S ** 2) / (4 * C)) +
        (A / 8) * (((3 * S) / C) * sqrtY + A * Math.sqrt(C / y));
    }
    if (!Number.isFinite(dF) || dF === 0) return null;

    const dz = F / dF;
    z -= dz;
    if (Math.abs(dz) < TOL) break;
  }
  if (iter >= MAX_ITERS) return null;

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
