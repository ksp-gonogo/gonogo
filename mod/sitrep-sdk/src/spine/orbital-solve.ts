import { magnitudeOr, type Quantityish } from "../magnitude";
import type { OrbitElements } from "./kepler";
import {
  buildElements,
  isHyperbolic,
  magnitude,
  trySolve,
  trySolveAnomalies,
  type WireOrbitElements,
} from "./kepler-reckoning";

/**
 * The orbital solve, as a pure function of an orbit and the instant you are
 * asking about.
 *
 * ## Why this is a function and not a hook
 *
 * The same mathematics is wanted for TWO orbits: the craft's
 * (`vessel.orbit`) and its target's (`vessel.target.orbit`, "the SAME
 * `VesselOrbit` shape as the self vessel, propagated to the same frozen
 * `viewUt`", as that derivation's own doc puts it). A solve bound to one topic
 * needs a second copy of itself for the other, which is how
 * `deriveTargetOrbit` came to re-derive period, true anomaly and the periapsis
 * altitude that `deriveVesselState` had already derived a few lines above.
 *
 * So the unit is `(orbit, viewUt, referenceBodyRadius)`. A hook that reads a
 * topic is a thin wrapper over this; it is never where the arithmetic lives.
 *
 * ## Why the body RADIUS is a parameter rather than a lookup
 *
 * Two of these fields are altitudes, which is a radius minus the reference
 * body's. Resolving that means walking `system.bodies`, and the walk carries a
 * three-way discipline (absent vs not-yet-resolvable vs confirmed tombstone)
 * that belongs to the caller's channel, not to the mathematics. Taking the
 * resolved radius keeps this pure and still lets the discipline through: pass
 * `undefined` for "cannot resolve yet" and `null` for a confirmed absence, and
 * the two altitude fields answer the same way.
 *
 * ## Hyperbolic orbits
 *
 * Real, on a fast escape or flyby under warp, and the elliptical-only solver
 * cannot take them. `trySolve`/`trySolveAnomalies` degrade to `null` rather
 * than throwing, so every field derived from them degrades in step and never
 * to a bogus number. `apoapsisRadius` needs its own check on top of that:
 * `sma·(1+ecc)` is still FINITE when `sma < 0`, just meaningless, so a finite
 * guard cannot catch it. Periapsis stays valid either way, `sma·(1-ecc)` being
 * a positive radius for both signs.
 */
export interface OrbitalSolve {
  /** Seconds, `2π/n`. */
  period: number | null;
  /** Degrees in `[0, 360)`, the widget-facing convention. */
  trueAnomaly: number | null;
  /** Seconds until the mean anomaly next reaches apoapsis. */
  timeToAp: number | null;
  /** Seconds until it next reaches periapsis. */
  timeToPe: number | null;
  /** `sma·(1+ecc)` from the body centre. `null` on a hyperbolic orbit, which has no apoapsis. */
  apoapsisRadius: number | null;
  /** `sma·(1-ecc)` from the body centre. */
  periapsisRadius: number | null;
  /** The solved position's distance from the body centre. */
  orbitalRadius: number | null;
  /** {@link apoapsisRadius} less the reference body's, i.e. an altitude. */
  apoapsisAlt: number | null | undefined;
  /** {@link periapsisRadius} less the reference body's. */
  periapsisAlt: number | null | undefined;
  /** `1` = apoapsis next, `-1` = periapsis next, `null` when neither countdown is available. */
  nextApsisType: number | null;
  /** Seconds to whichever {@link nextApsisType} names. */
  timeToNextApsis: number | null;
}

/** A wire quantity's magnitude, or `NaN` when the field is absent: see `vessel-state.ts`'s `mag` for why NaN is the right fallback here. */
function mag(v: Quantityish): number {
  return magnitudeOr(v, Number.NaN);
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wraps a degree value into [0, 360), the KSP widget-facing angle convention (contrast `kepler.ts`'s internal [0, 2π) radian wrap). */
function wrapDegrees360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Seconds from `meanAnomaly` (radians) until the mean anomaly next reaches
 * `targetMeanAnomaly` (radians), wrapped forward to `[0, period)`, 0 when
 * already there. `null` for a non-finite or non-positive `meanMotion` (never
 * divide by zero/negative: a degenerate orbit has no well-defined period to
 * count down within).
 */
function timeToMeanAnomaly(
  meanAnomaly: number,
  targetMeanAnomaly: number,
  meanMotion: number,
): number | null {
  if (
    !Number.isFinite(meanAnomaly) ||
    !Number.isFinite(targetMeanAnomaly) ||
    !Number.isFinite(meanMotion) ||
    meanMotion <= 0
  ) {
    return null;
  }
  const twoPi = 2 * Math.PI;
  let delta = (targetMeanAnomaly - meanAnomaly) % twoPi;
  if (delta < 0) delta += twoPi;
  return delta / meanMotion;
}

/**
 * Which apsis comes next and the seconds until it: whichever of the two
 * countdowns is the smaller non-`null` value.
 *
 * Never the legacy `0`/N-A sentinel. An unavailable next-apsis is `null`, which
 * the consuming chip treats identically, rendering only for a `±1` type with a
 * finite time.
 */
function nextApsis(
  timeToAp: number | null,
  timeToPe: number | null,
): { nextApsisType: number | null; timeToNextApsis: number | null } {
  if (timeToAp != null && (timeToPe == null || timeToAp <= timeToPe)) {
    return { nextApsisType: 1, timeToNextApsis: timeToAp };
  }
  if (timeToPe != null) {
    return { nextApsisType: -1, timeToNextApsis: timeToPe };
  }
  return { nextApsisType: null, timeToNextApsis: null };
}

/**
 * Solve `orbit` for `viewUt`.
 *
 * `referenceBodyRadius` is the mean radius of the body the orbit is about,
 * already resolved by the caller: `undefined` where it cannot be resolved yet,
 * `null` where its channel is a confirmed tombstone. Only the two altitude
 * fields read it, and they answer with whichever of those they were given.
 */
export function solveOrbit(
  orbit: WireOrbitElements,
  viewUt: number,
  referenceBodyRadius: number | null | undefined,
): OrbitalSolve {
  const elements: OrbitElements = buildElements(orbit);
  const solved = trySolve(elements, viewUt);
  const anomalies = trySolveAnomalies(elements, viewUt);

  const period =
    anomalies == null
      ? null
      : finiteOrNull((2 * Math.PI) / anomalies.meanMotion);
  const trueAnomaly =
    anomalies == null
      ? null
      : finiteOrNull(wrapDegrees360(radToDeg(anomalies.trueAnomaly)));
  const timeToAp =
    anomalies == null
      ? null
      : timeToMeanAnomaly(anomalies.meanAnomaly, Math.PI, anomalies.meanMotion);
  const timeToPe =
    anomalies == null
      ? null
      : timeToMeanAnomaly(anomalies.meanAnomaly, 0, anomalies.meanMotion);

  const hyperbolic = isHyperbolic(mag(orbit.ecc));
  const apoapsisRadius = hyperbolic
    ? null
    : finiteOrNull(mag(orbit.sma) * (1 + mag(orbit.ecc)));
  const periapsisRadius = finiteOrNull(mag(orbit.sma) * (1 - mag(orbit.ecc)));
  const orbitalRadius =
    solved?.position == null ? null : finiteOrNull(magnitude(solved.position));

  const altitude = (radius: number | null): number | null | undefined =>
    referenceBodyRadius == null
      ? referenceBodyRadius
      : radius == null
        ? null
        : finiteOrNull(radius - referenceBodyRadius);

  return {
    period,
    trueAnomaly,
    timeToAp,
    timeToPe,
    apoapsisRadius,
    periapsisRadius,
    orbitalRadius,
    apoapsisAlt: hyperbolic ? null : altitude(apoapsisRadius),
    periapsisAlt: altitude(periapsisRadius),
    ...nextApsis(timeToAp, timeToPe),
  };
}
