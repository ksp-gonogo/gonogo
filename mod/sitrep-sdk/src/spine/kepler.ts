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
 * samples every tick. For that to work, the SDK must derive positions
 * identically to the C# server; `propagation.test.ts` pins this module
 * against `mod/golden-fixtures/propagation.json`, which is generated from
 * (and independently cross-checked against) `KeplerProvider`.
 *
 * Mirror C# exactly: same math, same conventions, same Newton-Raphson
 * initial-guess heuristic. Do not "improve" this independently of
 * `KeplerProvider.cs` -- if the algorithm needs to change, change both
 * sides and regenerate the golden fixtures.
 *
 * Deterministic and side-effect-free: no wall-clock, no RNG.
 *
 * An open orbit (ecc > 1, as on a flyby or an escape) is solved here through
 * the hyperbolic anomaly. `KeplerProvider` refuses one, so that branch has no
 * C# twin and no golden fixture; its tests check it against the vis-viva
 * energy and angular momentum of the elements instead. A parabolic orbit
 * (ecc exactly 1) has neither anomaly and is refused by name.
 */

import type { Value } from "../unit-system/value";

const MAX_NEWTON_ITERATIONS = 50;
const NEWTON_TOLERANCE = 1e-12;

/**
 * How far an orbit's elements can be trusted forward in time, as the payload
 * carries it beside them. Check it with {@link canPropagate} before carrying
 * an orbit forward.
 *
 * It differs from craft to craft, because it depends on nearby bodies: in an
 * n-body game, a low orbit around a small moon can stay accurate for hours
 * while a high orbit near another body drifts kilometres in an hour. In stock
 * KSP every orbit is `Unbounded`.
 *
 * @category Orbits and trajectories
 */
export interface PropagationHorizonLike {
  /** How far ahead the elements hold. */
  kind: PropagationHorizonKindLike;
  /** For `Until`, the UT the elements are trusted until: an instant, not a duration. `null` or absent otherwise. */
  untilUt?: { magnitude: number } | number | null;
  /**
   * Whether the elements are a fixed orbit or a snapshot of a path the game is
   * integrating. Always present in a payload. It does not change what
   * {@link canPropagate} decides, only what its refusal reports.
   */
  trajectoryKind?: TrajectoryKindLike;
}

/**
 * Mirrors the contract enum by value rather than importing it, because this
 * module is the propagator's twin and deliberately depends on nothing generated.
 */
export const PropagationHorizonKindLike = {
  Unspecified: 0,
  Unbounded: 1,
  Until: 2,
} as const;
export type PropagationHorizonKindLike =
  (typeof PropagationHorizonKindLike)[keyof typeof PropagationHorizonKindLike];

/** Mirrors the contract enum by value, for the same reason as the horizon kind above. */
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
       * What kind of result was bounded. Present so a readout can say why a
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
 * reads it here rather than unwrapping the wire's magnitude a second time. The
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
 * Returns whether an orbit with this horizon may be carried across
 * `fromUt` to `toUt`, both in UT seconds, or why not. An `Unbounded` horizon
 * allows any window. An `Until` horizon allows a window that ends by its
 * `untilUt`. A missing horizon, an `Unspecified` one, or an `Until` with no
 * UT is refused, since nothing says how far the orbit holds.
 *
 * @category Orbits and trajectories
 */
// Tolerates `undefined` rather than trusting the type: absent means a producer that predates or dropped the field.
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
 * Classical orbital elements of a body or craft relative to its parent, with
 * the epoch and mean anomaly needed to carry the orbit forward or back in
 * time. Angles are in radians, times in UT seconds, and lengths in metres.
 *
 * @category Orbits and trajectories
 */
export interface OrbitElements {
  /** Semi-major axis, in metres. Negative on an open orbit, as the game reports it. */
  sma: number;
  /** Eccentricity: 0 for a circle, below 1 for an ellipse, above 1 for an open orbit. */
  ecc: number;
  /** Inclination, radians. */
  inc: number;
  /** Longitude of ascending node, radians. */
  lan: number;
  /** Argument of periapsis, radians. */
  argPe: number;
  /** Mean anomaly at `epoch`, radians. On an open orbit it is zero at periapsis, negative before it, and unbounded. */
  meanAnomalyAtEpoch: number;
  /** UT (seconds) at which `meanAnomalyAtEpoch` is valid. */
  epoch: number;
  /** The parent body's gravitational parameter (GM), in m³/s². */
  mu: number;
}

/**
 * A vector as three plain numbers, `[x, y, z]`, as the orbit and frame
 * functions take and return it.
 *
 * @category Frames of reference
 */
export type Vec3Tuple = readonly [x: number, y: number, z: number];

/**
 * A position and velocity relative to the parent body, at one instant, in
 * metres and metres per second.
 *
 * @category Orbits and trajectories
 */
export interface StateVector {
  /** Position, in metres. */
  position: Vec3Tuple;
  /** Velocity, in metres per second. */
  velocity: Vec3Tuple;
}

/**
 * Where an orbit is at one instant, as angles in radians, with its mean
 * motion. {@link solveAnomalies} returns one.
 *
 * An open orbit (`ecc > 1`) has no period, so `2π / meanMotion` is not one:
 * its mean motion is only the rate its mean anomaly advances at.
 *
 * @category Orbits and trajectories
 */
export interface Anomalies {
  /** Mean anomaly at the solved instant: within `[0, 2π)` on a closed orbit, any real number on an open one. */
  meanAnomaly: number;
  /** Eccentric anomaly at the solved instant. On an open orbit this is the hyperbolic anomaly. */
  eccentricAnomaly: number;
  /** True anomaly at the solved instant. On an open orbit it stays inside the asymptotes, `|ν| < acos(-1/ecc)`. */
  trueAnomaly: number;
  /** Mean motion, radians/second: `sqrt(mu / |sma|^3)`. */
  meanMotion: number;
}

/**
 * Returns whether an orbit of eccentricity `ecc` is open, solved through the
 * hyperbolic anomaly, or closed, solved through the eccentric one. Throws a
 * `RangeError` for a negative eccentricity and for a parabolic orbit
 * (`ecc` exactly 1), which has neither anomaly.
 */
function isOpenConic(ecc: number): boolean {
  if (ecc > 1.0) return true;
  if (ecc === 1.0) {
    throw new RangeError(
      "A parabolic orbit (ecc = 1) is not solved here: it has no eccentric or hyperbolic anomaly",
    );
  }
  if (ecc < 0.0) {
    throw new RangeError(`Eccentricity cannot be negative; got ecc=${ecc}`);
  }
  return false;
}

/**
 * Returns the true anomaly for an eccentric anomaly, both in radians, for an
 * elliptical orbit (`0 <= ecc < 1`). Correct in every quadrant.
 *
 * @category Orbits and trajectories
 */
export function trueAnomalyFromEccentric(
  eccentricAnomaly: number,
  ecc: number,
): number {
  return (
    2.0 *
    Math.atan2(
      Math.sqrt(1.0 + ecc) * Math.sin(eccentricAnomaly / 2.0),
      Math.sqrt(1.0 - ecc) * Math.cos(eccentricAnomaly / 2.0),
    )
  );
}

/**
 * The inverse of {@link trueAnomalyFromEccentric}: true to eccentric anomaly.
 * Radians, `0 <= ecc < 1`.
 *
 * @category Orbits and trajectories
 */
export function eccentricFromTrueAnomaly(
  trueAnomaly: number,
  ecc: number,
): number {
  return (
    2.0 *
    Math.atan2(
      Math.sqrt(1.0 - ecc) * Math.sin(trueAnomaly / 2.0),
      Math.sqrt(1.0 + ecc) * Math.cos(trueAnomaly / 2.0),
    )
  );
}

/**
 * Returns the true anomaly for a hyperbolic anomaly, both in radians, on an
 * open orbit (`ecc > 1`). Zero at periapsis and negative before it.
 *
 * @category Orbits and trajectories
 * @intent an Uplink that solved a hyperbolic anomaly of its own, for a flyby or an escape preview, turns it into the angle a drawn point needs
 */
export function trueAnomalyFromHyperbolic(
  hyperbolicAnomaly: number,
  ecc: number,
): number {
  return (
    2.0 *
    Math.atan(
      Math.sqrt((ecc + 1.0) / (ecc - 1.0)) * Math.tanh(hyperbolicAnomaly / 2.0),
    )
  );
}

/**
 * Returns `orbit`'s anomalies and mean motion at `ut`, in UT seconds: the
 * same computation {@link solve} makes, for a caller that needs an angle
 * rather than a position. An open orbit (`ecc > 1`) is solved through the
 * hyperbolic anomaly; see {@link Anomalies} for what each field holds then.
 * Throws a `RangeError` for a parabolic orbit (`ecc` exactly 1) and for a
 * negative eccentricity.
 *
 * @category Orbits and trajectories
 */
export function solveAnomalies(orbit: OrbitElements, ut: number): Anomalies {
  // Only the size of the semi-major axis is read on an open orbit, which the game reports as negative.
  const sma = isOpenConic(orbit.ecc) ? Math.abs(orbit.sma) : orbit.sma;
  const meanMotion = Math.sqrt(orbit.mu / (sma * sma * sma));
  const advanced = orbit.meanAnomalyAtEpoch + meanMotion * (ut - orbit.epoch);
  if (orbit.ecc > 1.0) {
    const hyperbolicAnomaly = solveHyperbolicAnomaly(advanced, orbit.ecc);
    return {
      meanAnomaly: advanced,
      eccentricAnomaly: hyperbolicAnomaly,
      trueAnomaly: trueAnomalyFromHyperbolic(hyperbolicAnomaly, orbit.ecc),
      meanMotion,
    };
  }

  const meanAnomaly = wrapTwoPi(advanced);

  const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, orbit.ecc);

  const trueAnomaly = trueAnomalyFromEccentric(eccentricAnomaly, orbit.ecc);

  return { meanAnomaly, eccentricAnomaly, trueAnomaly, meanMotion };
}

/**
 * The mean anomaly, in radians, `ut` reaches from `meanAnomalyAtEpoch` at
 * `meanMotion`: `M0 + n·(ut − epoch)`.
 *
 * Every term is a quantity up to the sum, and the sum is where the algebra
 * stops: what reads it is the Kepler solve, which is trigonometry on a number.
 * A propagation that advances a conic in time goes through here rather than
 * subtracting instants of its own, so the instant, the interval and the rate
 * keep their units right up to the solve.
 */
export function meanAnomalyAt(
  meanAnomalyAtEpoch: Value<"rad">,
  meanMotion: Value<"rad·s⁻¹">,
  epoch: Value<"ut">,
  ut: Value<"ut">,
): number {
  return meanAnomalyAtEpoch.plus(meanMotion.times(ut.minus(epoch))).magnitude;
}

/**
 * The shape and phase of a conic, closed or open, as quantities.
 *
 * @category Orbits and trajectories
 */
export interface ConicShape {
  /** Semi-major axis. Negative on an open orbit. */
  sma: Value<"m">;
  /** Eccentricity: below 1 for a closed orbit, above 1 for an open one. */
  ecc: Value<"1">;
  /** Mean anomaly at `epoch`. */
  meanAnomalyAtEpoch: Value<"rad">;
  /** The instant `meanAnomalyAtEpoch` holds at. */
  epoch: Value<"ut">;
}

/**
 * Where a craft is along its conic, in the orbital plane: the anomalies and
 * the distance from the body's centre. Angles in radians, `radius` in metres.
 *
 * @category Orbits and trajectories
 */
export interface ConicSolution {
  /** Mean anomaly at the solved instant: wrapped to `[0, 2π)` on a closed orbit, any real number on an open one. */
  meanAnomaly: number;
  /** Eccentric anomaly at the solved instant. On an open orbit this is the hyperbolic anomaly. */
  eccentricAnomaly: number;
  /** True anomaly at the solved instant. */
  trueAnomaly: number;
  /** Distance from the body's centre. */
  radius: number;
}

/**
 * Returns where an orbit is at `ut`, in its own plane: its anomalies and its
 * distance from the body's centre. For a position, use {@link solve}.
 *
 * Pass the mean motion yourself, in radians per second: `2π / period` for a
 * closed orbit from the game, which carries its period, or `√(mu / |sma|³)`
 * for elements alone, which is the only source on an open orbit. Throws a
 * `RangeError` for a parabolic orbit (`ecc` exactly 1) and for a negative
 * eccentricity.
 *
 * @category Orbits and trajectories
 * @intent an Uplink drawing its own patch chain or manoeuvre preview advances a conic the same way the built-in widgets do, with the figure for the mean motion that suits its source
 */
export function solveConic(
  conic: ConicShape,
  meanMotion: Value<"rad·s⁻¹">,
  ut: Value<"ut">,
): ConicSolution {
  const ecc = conic.ecc.magnitude;
  const sma = conic.sma.magnitude;
  const advanced = meanAnomalyAt(
    conic.meanAnomalyAtEpoch,
    meanMotion,
    conic.epoch,
    ut,
  );
  if (isOpenConic(ecc)) {
    const hyperbolicAnomaly = solveHyperbolicAnomaly(advanced, ecc);
    return {
      meanAnomaly: advanced,
      eccentricAnomaly: hyperbolicAnomaly,
      trueAnomaly: trueAnomalyFromHyperbolic(hyperbolicAnomaly, ecc),
      radius: Math.abs(sma) * (ecc * Math.cosh(hyperbolicAnomaly) - 1),
    };
  }
  const eccentricAnomaly = solveEccentricAnomaly(advanced, ecc);
  return {
    meanAnomaly: wrapTwoPi(advanced),
    eccentricAnomaly,
    trueAnomaly: trueAnomalyFromEccentric(eccentricAnomaly, ecc),
    radius: sma * (1 - ecc * Math.cos(eccentricAnomaly)),
  };
}

/**
 * Returns the position and velocity of `orbit` at `ut`, in UT seconds,
 * relative to its parent body. On a closed orbit, the same result as the
 * mod's own propagation. An open orbit (`ecc > 1`) is carried along its
 * hyperbola, and only the size of `sma` is read for one. Throws a
 * `RangeError` for a parabolic orbit (`ecc` exactly 1) and for a negative
 * eccentricity.
 *
 * @category Orbits and trajectories
 */
export function solve(orbit: OrbitElements, ut: number): StateVector {
  const { eccentricAnomaly, trueAnomaly } = solveAnomalies(orbit, ut);

  const open = orbit.ecc > 1.0;
  const radius = open
    ? Math.abs(orbit.sma) * (orbit.ecc * Math.cosh(eccentricAnomaly) - 1.0)
    : orbit.sma * (1.0 - orbit.ecc * Math.cos(eccentricAnomaly));

  // Specific angular momentum magnitude; for ecc=0 this reduces to sqrt(mu*sma), giving the expected circular speed sqrt(mu/sma) below.
  const h = open
    ? Math.sqrt(orbit.mu * Math.abs(orbit.sma) * (orbit.ecc * orbit.ecc - 1.0))
    : Math.sqrt(orbit.mu * orbit.sma * (1.0 - orbit.ecc * orbit.ecc));

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
 * Starts from a high-eccentricity guess where it needs one, so it converges
 * just after periapsis on a near-parabolic orbit too.
 *
 * **Exported as arithmetic, not as propagation.** It takes a mean anomaly
 * and an eccentricity and returns an angle: no elements, no frame, no time, so
 * it cannot say "where is this craft" and is not a way around the propagation
 * seam. That question goes through a provider, and on the C# side the
 * equivalent element-keyed door is deliberately private.
 *
 * Accepts any real mean anomaly and wraps it, because its callers propagate `M`
 * linearly in time and hand over values well outside one revolution.
 */
export function solveEccentricAnomaly(
  meanAnomaly: number,
  ecc: number,
): number {
  if (ecc < 0.0 || ecc >= 1.0) {
    // An open orbit has no eccentric anomaly to return; `solveHyperbolicAnomaly` solves the open form.
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

const MAX_HYPERBOLIC_ITERATIONS = 100;

/**
 * Returns the hyperbolic anomaly `H` that solves `M = e·sinh(H) − H` for a
 * mean anomaly `M`, in radians, on an open orbit (`ecc > 1`). `M` is any real
 * number: zero at periapsis, negative before it. Throws a `RangeError` when
 * `ecc` is not above 1.
 *
 * @category Orbits and trajectories
 * @intent an Uplink previewing a flyby or an escape of its own advances the open orbit with the same solver the built-in widgets use
 */
export function solveHyperbolicAnomaly(
  meanAnomaly: number,
  ecc: number,
): number {
  /*
   * Newton-Raphson from above the root. The equation is odd in H, so it is
   * solved for |M| and the sign restored. For H > 0 the function
   * f(H) = e·sinh(H) − H − |M| is increasing and convex, and
   * e·sinh(H) − H >= (e − 1)·sinh(H) puts asinh(|M| / (e − 1)) at or above the
   * root. Newton on an increasing convex function from above its root steps
   * down toward it and never past it, so this converges for every |M| and
   * every e > 1, a grazing e included, where a start at M itself can diverge.
   */
  if (!(ecc > 1.0)) {
    throw new RangeError(
      `The hyperbolic form of Kepler's equation needs an open orbit (ecc > 1); got ecc=${ecc}`,
    );
  }
  const target = Math.abs(meanAnomaly);
  if (target === 0 || !Number.isFinite(target)) return meanAnomaly;

  let hyperbolicAnomaly = Math.asinh(target / (ecc - 1.0));
  for (let i = 0; i < MAX_HYPERBOLIC_ITERATIONS; i++) {
    const f = ecc * Math.sinh(hyperbolicAnomaly) - hyperbolicAnomaly - target;
    const fPrime = ecc * Math.cosh(hyperbolicAnomaly) - 1.0;
    const delta = f / fPrime;
    hyperbolicAnomaly -= delta;
    if (Math.abs(delta) < NEWTON_TOLERANCE * Math.max(1.0, hyperbolicAnomaly)) {
      break;
    }
  }
  return meanAnomaly < 0 ? -hyperbolicAnomaly : hyperbolicAnomaly;
}

/**
 * Rotates a perifocal-frame vector into the parent-body-relative inertial
 * frame using the 3-1-3 Euler rotation R3(-lan) * R1(-inc) * R3(-argPe)
 * (Vallado/AIAA convention). Applies identically to position and velocity
 * components. Mirrors `RotatePerifocalToInertial`.
 *
 * `zPf` is the part along the orbit normal. A conic has none, so it is left
 * out and the vector is planar; an integrated arc leaves the osculating plane
 * and passes it.
 *
 * @category Orbits and trajectories
 */
export function rotatePerifocalToInertial(
  xPf: number,
  yPf: number,
  inc: number,
  lan: number,
  argPe: number,
  zPf = 0,
): Vec3Tuple {
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

  if (zPf === 0) {
    return [
      r11 * xPf + r12 * yPf,
      r21 * xPf + r22 * yPf,
      r31 * xPf + r32 * yPf,
    ];
  }

  return [
    r11 * xPf + r12 * yPf + sinLan * sinInc * zPf,
    r21 * xPf + r22 * yPf - cosLan * sinInc * zPf,
    r31 * xPf + r32 * yPf + cosInc * zPf,
  ];
}

/**
 * The inverse of the rotation above: a body-centred inertial vector expressed
 * in the perifocal frame of the element set given.
 *
 * Exported because an integrated path arrives in the inertial frame and the
 * body-centric diagrams draw in the perifocal one, so somewhere the two have to
 * meet. Doing it here keeps the rotation matrix in the one file that owns it:
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
  v: Vec3Tuple,
  inc: number,
  lan: number,
  argPe: number,
): Vec3Tuple {
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
