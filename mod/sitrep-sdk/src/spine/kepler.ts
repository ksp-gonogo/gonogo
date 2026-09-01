/**
 * Analytic two-body (Keplerian) propagator: the TS twin of
 * `mod/Sitrep.Propagation/KeplerProvider.cs`. Solves Kepler's equation for
 * the eccentric anomaly via Newton-Raphson, then reconstructs the
 * parent-body-relative state vector by rotating the perifocal-frame
 * position/velocity into the inertial frame using the standard 3-1-3 Euler
 * rotation (argument of periapsis, then inclination, then longitude of
 * ascending node -- the Vallado/AIAA convention).
 *
 * This is the derived-channel foundation for the streaming delay model: the mod
 * transmits sparse orbital
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
 * The client half of the propagation seam: whether an element set answers for a
 * window, asked BEFORE propagating into it.
 *
 * The TS twin of `IPropagationProvider.CanPropagate(target, frame, fromUt,
 * toUt)`, deliberately the same shape rather than a second design. Mod-side
 * that method takes a window precisely so a provider with a horizon can decline,
 * and until now no caller passed a window it cared about; this is that caller.
 *
 * ## Why a client cannot answer this itself
 *
 * The horizon depends on the perturbation environment (which bodies are near,
 * how massive, how far), so it arrives on the sample from the only thing that
 * knows. It is a LOCAL property: the same save at the same instant has horizons
 * differing by orders of magnitude between craft, because the perturbation ratio
 * scales as `2 (mu_perturber / mu_primary) (r / d)^3`. A measured 20 km Minmus
 * orbit drifts ~11 m per hour under two-body extrapolation; an ordinary
 * high-Kerbin orbit perturbed by the Mun drifts ~19 km per hour. One global
 * answer cannot be right, and reconstructing it client-side would mean
 * reimplementing the thing this seam exists to avoid.
 *
 * ## It does not refuse anything yet, and that is not a dead branch
 *
 * The only elected provider is the analytic two-body solver, which has no
 * horizon and says so (`Unbounded`). This gate therefore permits everything
 * today. It becomes load-bearing when a provider that INTEGRATES, i.e. an
 * n-body backend, is elected and starts returning `Until`. Do not delete it as
 * unreachable: it is the system working with a provider that has no limit.
 */
export interface PropagationHorizonLike {
  kind: PropagationHorizonKindLike;
  /** Only meaningful for `Until`; a UT, not a duration. */
  untilUt?: { magnitude: number } | number;
  /**
   * What KIND of answer these elements are: a closed-form conic, or a snapshot
   * of an integrated path. Optional HERE and required on the wire, because this
   * shape also describes a caller-built horizon in a test.
   *
   * Carried so a refusal can say what a client cannot DO rather than who it
   * cannot ask. Never consulted by the gate's decision, which is `kind` and
   * `untilUt` alone: the horizon answers reach, this answers shape, and mixing
   * them is the confusion the field exists to end.
   */
  trajectoryKind?: TrajectoryKindLike;
}

/**
 * Mirrors the contract enum by VALUE rather than importing it, because this
 * module is the propagator's twin and deliberately depends on nothing generated.
 */
export const PropagationHorizonKindLike = {
  Unspecified: 0,
  Unbounded: 1,
  Until: 2,
} as const;
export type PropagationHorizonKindLike =
  (typeof PropagationHorizonKindLike)[keyof typeof PropagationHorizonKindLike];

/** Mirrors the contract enum by VALUE, for the same reason as the horizon kind above. */
export const TrajectoryKindLike = {
  Unspecified: 0,
  Analytic: 1,
  Integrated: 2,
} as const;
export type TrajectoryKindLike =
  (typeof TrajectoryKindLike)[keyof typeof TrajectoryKindLike];

/** Why a propagation was refused, for a caller that wants to say so on screen. */
export type PropagationRefusal =
  | { propagatable: true }
  | { propagatable: false; reason: "no-horizon-stated" }
  | {
      propagatable: false;
      reason: "past-horizon";
      horizonUt: number;
      /**
       * What kind of answer was bounded. Present so a readout can say WHY a
       * conic stopped rather than going blank: an integrated trajectory past its
       * horizon is a different sentence from an analytic one, and the operator
       * can act on the difference.
       */
      trajectoryKind?: TrajectoryKindLike;
    };

/**
 * The horizon's bound as a plain UT, or `undefined` when it names none.
 *
 * Exported so a caller that needs the number for something other than the gate
 * reads it HERE rather than unwrapping the wire's magnitude a second time. The
 * one-copy rule is the same one `solveEccentricAnomaly`'s own doc argues for,
 * and for the same reason: a second copy is free to disagree.
 */
export function horizonUtOf(
  horizon: PropagationHorizonLike,
): number | undefined {
  const raw = horizon.untilUt;
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === "number" ? raw : raw.magnitude;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Whether `horizon` authorises propagating across `[fromUt, toUt]`.
 *
 * An `Unspecified` horizon REFUSES. Nobody stated one, and "nobody said" must
 * not read as "trust this forever": that is the permissive default this whole
 * seam exists to remove, and it would fail silently the first time a producer
 * forgot the field.
 *
 * An `Until` horizon with no usable UT also refuses, for the same reason: the
 * arm claims a bound and then fails to name it.
 */
export function canPropagate(
  horizon: PropagationHorizonLike | undefined,
  fromUt: number,
  toUt: number,
): PropagationRefusal {
  // Tolerates `undefined` and refuses, rather than trusting the type. The field
  // is required on the wire, so absent means a producer predating it or one that
  // dropped it, and neither is a licence to extrapolate. Throwing here would
  // take a whole widget down inside render for a state the gate can answer.
  if (horizon === undefined || horizon === null) {
    return { propagatable: false, reason: "no-horizon-stated" };
  }
  if (horizon.kind === PropagationHorizonKindLike.Unbounded) {
    return { propagatable: true };
  }
  if (horizon.kind !== PropagationHorizonKindLike.Until) {
    return { propagatable: false, reason: "no-horizon-stated" };
  }
  const horizonUt = horizonUtOf(horizon);
  if (horizonUt === undefined) {
    return { propagatable: false, reason: "no-horizon-stated" };
  }
  // Both ends are checked. A window that starts beyond the horizon is no more
  // answerable than one that ends beyond it, and a caller sweeping backwards
  // should not slip through on the `to` end alone.
  if (Math.max(fromUt, toUt) > horizonUt) {
    return {
      propagatable: false,
      reason: "past-horizon",
      horizonUt,
      trajectoryKind: horizon.trajectoryKind,
    };
  }
  return { propagatable: true };
}

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
 * Newton-Raphson solve of Kepler's equation `M = E - e*sin(E)` for E.
 * Converges in ~5 iterations for typical (e < 0.9) orbits; the iteration
 * cap and tolerance below are a guard against pathological inputs near
 * e -> 1, not the expected case. Mirrors `SolveEccentricAnomaly`.
 *
 * **THE ONE Newton iteration on Kepler's equation in this repo.** There were three:
 * this one, `core/src/calc/trajectory.ts`'s `solveKepler`, and a hand-copy of that in
 * `orbit-patches.ts`. The other two started Newton at `M + e sin(M)` with no
 * high-eccentricity branch, so from `e = 0.994` upward they failed to converge on a
 * minority of mean anomalies just after periapsis and returned their last iterate,
 * wrong by up to pi radians and saying nothing. `kepler-conformance.test.ts` is what
 * caught it and is what keeps this the only one.
 *
 * <b>Exported as ARITHMETIC, not as propagation.</b> It takes a mean anomaly and an
 * eccentricity and returns an angle: no elements, no frame, no time, so it cannot
 * answer "where is this craft" and is not a way around the propagation seam. That
 * question goes through a provider, and on the C# side the equivalent element-keyed
 * door is deliberately private.
 *
 * Accepts any real mean anomaly and wraps it, because its callers propagate `M`
 * linearly in time and hand over values well outside one revolution.
 */
export function solveEccentricAnomaly(
  meanAnomaly: number,
  ecc: number,
): number {
  if (ecc < 0.0 || ecc >= 1.0) {
    // The same refusal `solveAnomalies` and `solve` give, for the same reason: the
    // elliptic form of Kepler's equation does not describe an unbound trajectory, so
    // there is no answer to return. Returning one anyway is precisely the defect this
    // function exists to have exactly one copy of.
    throw new RangeError(
      `Kepler's equation is solved here only for elliptical orbits (0 <= ecc < 1); got ecc=${ecc}`,
    );
  }

  return solveWrappedEccentricAnomaly(wrapTwoPi(meanAnomaly), ecc);
}

function solveWrappedEccentricAnomaly(
  meanAnomaly: number,
  ecc: number,
): number {
  if (ecc < 1e-12) {
    // Circular orbit: E = M exactly. The Newton step below would converge to
    // this immediately anyway, so the short-circuit is here to say the e~=0
    // case is handled deliberately rather than being accidentally fine.
    return meanAnomaly;
  }

  // Standard high-eccentricity-aware initial guess (Vallado). Starting at M
  // works for low and moderate e, but biasing the guess toward periapsis for
  // higher e stops Newton-Raphson overshooting near e -> 1.
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

  // Never satisfying the tolerance simply returns the last iterate rather than throwing, the same non-convergence handling as the C# side.
  return eccentricAnomaly;
}

/**
 * Rotates a planar perifocal-frame vector (z=0) into the parent-body-relative
 * inertial frame using the 3-1-3 Euler rotation R3(-lan) * R1(-inc) * R3(-argPe)
 * (Vallado/AIAA convention). Applies identically to position and velocity
 * components. Mirrors `RotatePerifocalToInertial`.
 */
export function rotatePerifocalToInertial(
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

/**
 * The inverse of the rotation above: a body-centred inertial vector expressed
 * in the perifocal frame of the element set given.
 *
 * Exported because an integrated path arrives in the inertial frame and the
 * body-centric diagrams draw in the perifocal one, so somewhere the two have to
 * meet. Doing it HERE keeps the rotation matrix in the one file that owns it:
 * a second copy of those nine terms elsewhere is free to disagree with this one
 * about a sign, and the symptom would be a curve that looks plausible and is
 * mirrored.
 *
 * The rotation is orthonormal, so the inverse is the transpose and no matrix
 * needs inverting. The out-of-plane component survives as `z`: a caller that
 * flattens it to a plane is throwing away the one thing an n-body path has that
 * a conic does not.
 */
export function rotateInertialToPerifocal(
  v: Vector3,
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
  const r13 = sinLan * sinInc;
  const r21 = sinLan * cosArgPe + cosLan * sinArgPe * cosInc;
  const r22 = -sinLan * sinArgPe + cosLan * cosArgPe * cosInc;
  const r23 = -cosLan * sinInc;
  const r31 = sinArgPe * sinInc;
  const r32 = cosArgPe * sinInc;
  const r33 = cosInc;

  const [x, y, z] = v;
  return [
    r11 * x + r21 * y + r31 * z,
    r12 * x + r22 * y + r32 * z,
    r13 * x + r23 * y + r33 * z,
  ];
}

function wrapTwoPi(angle: number): number {
  const twoPi = 2.0 * Math.PI;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}
