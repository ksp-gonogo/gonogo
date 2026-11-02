import type { Point2 } from "./craft";

/** One patch of the craft's trajectory around the body in question, as plain numbers. */
export interface PatchNumbers {
  /** Negative for a hyperbola. */
  sma: number;
  ecc: number;
  /** The conic's semi-latus rectum, metres. */
  semiLatusRectum: number;
  /** Periapsis altitude above the body's mean radius, metres. */
  periapsisAltitude: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
  mu: number;
}

/** What the Encounter circle is drawn from, in metres with the body at the origin and periapsis straight up. */
export interface EncounterGeometry {
  bodyRadius: number;
  soi: number;
  /** The path through the sphere of influence, entry to exit for an open conic, the whole orbit for a closed one. */
  path: Point2[];
  periapsis: { point: Point2; altitude: number };
  /** Where the path crosses the sphere of influence, null for a closed orbit inside it. */
  entry: Point2 | null;
  exit: Point2 | null;
  /** Where the craft is on the path now, null while it is not on this patch or outside the sphere. */
  craft: Point2 | null;
}

function pointAt(p: number, ecc: number, nu: number): Point2 {
  const r = p / (1 + ecc * Math.cos(nu));
  // Perifocal (periapsis on +x) turned a quarter so periapsis is up and the craft travels left.
  return [-r * Math.sin(nu), r * Math.cos(nu)];
}

/**
 * The path through a body's sphere of influence from the patch that lies in
 * it. Null where the numbers do not describe a conic that reaches the sphere
 * or the body is unknown.
 */
export function encounterGeometry(
  patch: PatchNumbers,
  body: { radius: number; soi: number },
  ut?: number,
): EncounterGeometry | null {
  const { ecc, semiLatusRectum: p } = patch;
  if (!(p > 0) || !(ecc >= 0) || !(body.soi > 0) || !(body.radius > 0))
    return null;
  const rp = p / (1 + ecc);
  const periapsis = {
    point: pointAt(p, ecc, 0),
    altitude: patch.periapsisAltitude,
  };
  if (ecc >= 1) {
    const cosNu = (p / body.soi - 1) / ecc;
    if (!(cosNu > -1 && cosNu < 1)) return null;
    const limit = Math.acos(cosNu);
    const path: Point2[] = [];
    const steps = 120;
    for (let k = 0; k <= steps; k++) {
      path.push(pointAt(p, ecc, -limit + (2 * limit * k) / steps));
    }
    return {
      bodyRadius: body.radius,
      soi: body.soi,
      path,
      periapsis,
      entry: path[0],
      exit: path[steps],
      craft: craftOnPatch(patch, body.soi, ut),
    };
  }
  const path: Point2[] = [];
  const steps = 180;
  for (let k = 0; k <= steps; k++)
    path.push(pointAt(p, ecc, (2 * Math.PI * k) / steps));
  return rp > 0
    ? {
        bodyRadius: body.radius,
        soi: body.soi,
        path,
        periapsis,
        entry: null,
        exit: null,
        craft: craftOnPatch(patch, body.soi, ut),
      }
    : null;
}

/**
 * Seconds from `ut` to the patch's periapsis. Hyperbolic patches count from
 * the mean anomaly (negative before periapsis); a closed one gives the next.
 * Null where the patch has no mean motion.
 */
export function timeToPeriapsis(
  patch: PatchNumbers,
  ut: number,
): number | null {
  const a = Math.abs(patch.sma);
  if (!(a > 0) || !(patch.mu > 0)) return null;
  const n = Math.sqrt(patch.mu / a ** 3);
  const m = patch.meanAnomalyAtEpoch + n * (ut - patch.epoch);
  if (patch.ecc >= 1) return -m / n;
  const turn = 2 * Math.PI;
  const toPe = ((turn - (m % turn)) % turn) / n;
  return toPe;
}

/** The true anomaly of the craft on the patch at `ut`, radians; null where the patch has no mean motion. */
function trueAnomalyAt(patch: PatchNumbers, ut: number): number | null {
  const a = Math.abs(patch.sma);
  if (!(a > 0) || !(patch.mu > 0)) return null;
  const n = Math.sqrt(patch.mu / a ** 3);
  const m = patch.meanAnomalyAtEpoch + n * (ut - patch.epoch);
  const e = patch.ecc;
  if (e >= 1) {
    let h = Math.asinh(m / e);
    for (let i = 0; i < 60; i++) {
      const step = (e * Math.sinh(h) - h - m) / (e * Math.cosh(h) - 1);
      h -= step;
      if (Math.abs(step) < 1e-12) break;
    }
    return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(h / 2));
  }
  let big = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 40; i++) {
    const step = (big - e * Math.sin(big) - m) / (1 - e * Math.cos(big));
    big -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return (
    2 *
    Math.atan2(
      Math.sqrt(1 + e) * Math.sin(big / 2),
      Math.sqrt(1 - e) * Math.cos(big / 2),
    )
  );
}

/** Where the craft is on the patch at `ut`, inside the sphere of influence; null otherwise or without a time. */
export function craftOnPatch(
  patch: PatchNumbers,
  soi: number,
  ut: number | undefined,
): Point2 | null {
  if (ut === undefined) return null;
  const nu = trueAnomalyAt(patch, ut);
  if (nu === null) return null;
  const r = patch.semiLatusRectum / (1 + patch.ecc * Math.cos(nu));
  if (!(r > 0) || r > soi) return null;
  return [-r * Math.sin(nu), r * Math.cos(nu)];
}
