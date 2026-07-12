/**
 * Analytic two-body (Keplerian) propagator: the TS twin of
 * `mod/Sitrep.Propagation/KeplerProvider.cs`. Solves Kepler's equation for
 * the eccentric anomaly via Newton-Raphson, then reconstructs the
 * parent-body-relative state vector by rotating the perifocal-frame
 * position/velocity into the inertial frame using the standard 3-1-3 Euler
 * rotation (argument of periapsis, then inclination, then longitude of
 * ascending node -- the Vallado/AIAA convention).
 *
 * This is the derived-channel foundation for the streaming delay model
 * (spec-streaming-delay-model.md §4/§5): the mod transmits sparse orbital
 * elements over the wire, and each consumer -- the mod itself, and this SDK
 * -- derives position on demand rather than streaming dense position
 * samples every tick. For that to work, the SDK MUST derive positions
 * IDENTICALLY to the C# server; `propagation.test.ts` pins this module
 * against `mod/golden-fixtures/propagation.json`, which is generated from
 * (and independently cross-checked against) `KeplerProvider`.
 *
 * MIRROR C# EXACTLY: same math, same conventions, same Newton-Raphson
 * initial-guess heuristic. Do not "improve" this independently of
 * `KeplerProvider.cs` -- if the algorithm needs to change, change both
 * sides and regenerate the golden fixtures.
 *
 * Deterministic and side-effect-free: no wall-clock, no RNG. Only
 * elliptical orbits (0 <= ecc < 1) are supported -- this is the
 * dead-reckoning foundation for bound orbits, not an escape-trajectory
 * solver.
 */

const MAX_NEWTON_ITERATIONS = 50;
const NEWTON_TOLERANCE = 1e-12;

/**
 * Classical (Keplerian) orbital elements for a body relative to its parent,
 * plus the epoch/mean-anomaly pair needed to propagate the orbit forward
 * (or backward) in time.
 *
 * Unit convention: ALL angles (`inc`, `lan`, `argPe`, `meanAnomalyAtEpoch`)
 * are in RADIANS, not degrees. `epoch` and the `ut` passed to `solve` are in
 * UT seconds (KSP's universal time) -- never wall-clock. `mu` is the parent
 * body's standard gravitational parameter (GM), in the same length/time
 * units as the resulting state vector (KSP convention: meters and seconds).
 * Mirrors `OrbitElements.cs`.
 */
export interface OrbitElements {
  /** Semi-major axis. */
  sma: number;
  /** Eccentricity (0 = circular, <1 = elliptical). */
  ecc: number;
  /** Inclination, radians. */
  inc: number;
  /** Longitude of ascending node, radians. */
  lan: number;
  /** Argument of periapsis, radians. */
  argPe: number;
  /** Mean anomaly at `epoch`, radians. */
  meanAnomalyAtEpoch: number;
  /** UT (seconds) at which `meanAnomalyAtEpoch` is valid. */
  epoch: number;
  /** Parent body's standard gravitational parameter (GM). */
  mu: number;
}

/** A plain (x, y, z) tuple. Mirrors `Vector3d.cs`. */
export type Vector3 = readonly [x: number, y: number, z: number];

/** Position + velocity, both parent-body-relative, at a single instant. Mirrors `StateVector` in `Vector3d.cs`. */
export interface StateVector {
  position: Vector3;
  velocity: Vector3;
}

/**
 * The angular part of a Kepler solve: mean anomaly (from the epoch + mean
 * motion), eccentric anomaly (Newton-Raphson on Kepler's equation), and true
 * anomaly -- everything `solve()` needs before it gets to the perifocal
 * position/velocity. All in RADIANS. `meanMotion` (rad/s) is exposed
 * alongside them so a caller that needs a period/time-to-apsis (derived from
 * mean motion, not from any one anomaly) doesn't have to recompute
 * `sqrt(mu/sma^3)` a second time.
 */
export interface Anomalies {
  meanAnomaly: number;
  eccentricAnomaly: number;
  trueAnomaly: number;
  /** Mean motion, radians/second: `sqrt(mu / sma^3)`. */
  meanMotion: number;
}

/**
 * Solves for `orbit`'s mean/eccentric/true anomaly at time `ut` -- the exact
 * angular computation `solve()` itself uses, exposed standalone for callers
 * that need an anomaly (or the mean motion) without a full state vector
 * (`vessel-state.ts`'s `trueAnomaly`/`period`/`timeToAp`/`timeToPe` derived
 * fields). Reuses the SAME Newton-Raphson solve `solve()` calls below --
 * never reimplement Kepler's equation a second time. Same ellipse-only guard
 * as `solve()`.
 */
export function solveAnomalies(orbit: OrbitElements, ut: number): Anomalies {
  if (orbit.ecc < 0.0 || orbit.ecc >= 1.0) {
    throw new RangeError(
      `KeplerProvider only supports elliptical orbits (0 <= ecc < 1); got ecc=${orbit.ecc}`,
    );
  }

  const meanMotion = Math.sqrt(orbit.mu / (orbit.sma * orbit.sma * orbit.sma));
  const meanAnomaly = wrapTwoPi(
    orbit.meanAnomalyAtEpoch + meanMotion * (ut - orbit.epoch),
  );

  const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, orbit.ecc);

  const trueAnomaly =
    2.0 *
    Math.atan2(
      Math.sqrt(1.0 + orbit.ecc) * Math.sin(eccentricAnomaly / 2.0),
      Math.sqrt(1.0 - orbit.ecc) * Math.cos(eccentricAnomaly / 2.0),
    );

  return { meanAnomaly, eccentricAnomaly, trueAnomaly, meanMotion };
}

/**
 * Solve for the state vector of `orbit` at time `ut` (UT seconds). Mirrors
 * `KeplerProvider.Solve`. Deterministic -- same inputs, same outputs, no
 * wall-clock/random dependence. Throws for parabolic/hyperbolic
 * eccentricities (ecc < 0 or ecc >= 1), same guard as the C# side (via
 * `solveAnomalies`).
 */
export function solve(orbit: OrbitElements, ut: number): StateVector {
  const { eccentricAnomaly, trueAnomaly } = solveAnomalies(orbit, ut);

  const radius = orbit.sma * (1.0 - orbit.ecc * Math.cos(eccentricAnomaly));

  // Specific angular momentum magnitude; for ecc=0 this reduces to
  // sqrt(mu*sma), giving the expected circular speed sqrt(mu/sma) below.
  const h = Math.sqrt(orbit.mu * orbit.sma * (1.0 - orbit.ecc * orbit.ecc));

  const cosNu = Math.cos(trueAnomaly);
  const sinNu = Math.sin(trueAnomaly);

  const xPerifocal = radius * cosNu;
  const yPerifocal = radius * sinNu;

  const muOverH = orbit.mu / h;
  const vxPerifocal = -muOverH * sinNu;
  const vyPerifocal = muOverH * (orbit.ecc + cosNu);

  const position = rotatePerifocalToInertial(
    xPerifocal,
    yPerifocal,
    orbit.inc,
    orbit.lan,
    orbit.argPe,
  );
  const velocity = rotatePerifocalToInertial(
    vxPerifocal,
    vyPerifocal,
    orbit.inc,
    orbit.lan,
    orbit.argPe,
  );

  return { position, velocity };
}

/**
 * Newton-Raphson solve of Kepler's equation M = E - e*sin(E) for E.
 * Converges in ~5 iterations for typical (e < 0.9) orbits; the iteration
 * cap and tolerance below are a guard against pathological inputs near
 * e -> 1, not the expected case. Mirrors `SolveEccentricAnomaly`.
 */
function solveEccentricAnomaly(meanAnomaly: number, ecc: number): number {
  if (ecc < 1e-12) {
    // Circular orbit: E = M exactly, and the Newton step below would
    // converge to this immediately anyway -- short-circuit to avoid doing
    // pointless work (and to be explicit that the e~=0 case is
    // intentionally handled, not accidentally fine).
    return meanAnomaly;
  }

  // Standard high-eccentricity-aware initial guess (Vallado): starting at M
  // works for low/moderate e, but biases the guess toward periapsis for
  // higher e so Newton-Raphson doesn't overshoot near e -> 1.
  let eccentricAnomaly = ecc < 0.8 ? meanAnomaly : Math.PI;

  for (let i = 0; i < MAX_NEWTON_ITERATIONS; i++) {
    const f = eccentricAnomaly - ecc * Math.sin(eccentricAnomaly) - meanAnomaly;
    const fPrime = 1.0 - ecc * Math.cos(eccentricAnomaly);
    const delta = f / fPrime;
    eccentricAnomaly -= delta;

    if (Math.abs(delta) < NEWTON_TOLERANCE) {
      break;
    }
  }

  // If the loop above never satisfies the tolerance, this simply returns
  // the last iterate rather than throwing -- same non-convergence handling
  // as the C# side.
  return eccentricAnomaly;
}

/**
 * Rotates a planar perifocal-frame vector (z=0) into the parent-body-relative
 * inertial frame using the 3-1-3 Euler rotation R3(-lan) * R1(-inc) * R3(-argPe)
 * (Vallado/AIAA convention). Applies identically to position and velocity
 * components. Mirrors `RotatePerifocalToInertial`.
 */
function rotatePerifocalToInertial(
  xPf: number,
  yPf: number,
  inc: number,
  lan: number,
  argPe: number,
): Vector3 {
  const cosLan = Math.cos(lan);
  const sinLan = Math.sin(lan);
  const cosArgPe = Math.cos(argPe);
  const sinArgPe = Math.sin(argPe);
  const cosInc = Math.cos(inc);
  const sinInc = Math.sin(inc);

  const r11 = cosLan * cosArgPe - sinLan * sinArgPe * cosInc;
  const r12 = -cosLan * sinArgPe - sinLan * cosArgPe * cosInc;
  const r21 = sinLan * cosArgPe + cosLan * sinArgPe * cosInc;
  const r22 = -sinLan * sinArgPe + cosLan * cosArgPe * cosInc;
  const r31 = sinArgPe * sinInc;
  const r32 = cosArgPe * sinInc;

  const x = r11 * xPf + r12 * yPf;
  const y = r21 * xPf + r22 * yPf;
  const z = r31 * xPf + r32 * yPf;

  return [x, y, z];
}

function wrapTwoPi(angle: number): number {
  const twoPi = 2.0 * Math.PI;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}
