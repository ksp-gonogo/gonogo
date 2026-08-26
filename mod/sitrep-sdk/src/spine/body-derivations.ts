import { solveAnomalies } from "./kepler";

/**
 * The two celestial-body almanac values the GAME has no answer for, so the
 * client has to derive them. Everything else about a body is a wire field: see
 * `celestial-facts.ts` for the split and the reasoning.
 *
 * All inputs are nullable (the stream drops any value the live game hasn't
 * populated); every helper returns `null` rather than a NaN when it can't
 * compute a finite result, so a consumer can treat "unknown" as a single state.
 */

function finite(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

function isPos(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

/** Escape velocity from the surface, m/s: `v = √(2μ / r)`. */
export function deriveEscapeVelocity(
  gravParameter: number | null | undefined,
  radius: number | null | undefined,
): number | null {
  if (!isPos(gravParameter) || !isPos(radius)) return null;
  return finite(Math.sqrt((2 * gravParameter) / radius));
}

/**
 * Orbital period, seconds, from the semi-major axis and the PARENT body's μ:
 * `T = 2π · √(a³ / μ_parent)`. `null` for a missing/non-positive input.
 *
 * Deliberately not taken off the wire, unlike mass / surface gravity / hill
 * sphere: KSP's own `Orbit.period` is `2π/meanMotion` over
 * `meanMotion = √(μ/|a|³)` (decompiled), so this IS the game's expression
 * rather than a reconstruction of it.
 */
export function derivePeriod(
  semiMajorAxis: number | null | undefined,
  parentGravParameter: number | null | undefined,
): number | null {
  if (!isPos(semiMajorAxis) || !isPos(parentGravParameter)) return null;
  return finite(
    2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / parentGravParameter),
  );
}

/**
 * True anomaly, DEGREES in `[0, 360)`, at universal time `ut`, reconstructed
 * from the mean anomaly at epoch via the shared Kepler solver (never a second
 * reimplementation of Kepler's equation). Returns `null` for a
 * parabolic/hyperbolic orbit (the solver's `ecc ∈ [0, 1)` domain), a missing
 * input, or a non-finite `ut`.
 */
export function deriveTrueAnomalyDeg(params: {
  semiMajorAxis: number | null | undefined;
  eccentricity: number | null | undefined;
  meanAnomalyAtEpoch: number | null | undefined;
  epoch: number | null | undefined;
  parentGravParameter: number | null | undefined;
  ut: number | null | undefined;
}): number | null {
  const {
    semiMajorAxis,
    eccentricity,
    meanAnomalyAtEpoch,
    epoch,
    parentGravParameter,
    ut,
  } = params;
  if (
    !isPos(semiMajorAxis) ||
    !isPos(parentGravParameter) ||
    typeof eccentricity !== "number" ||
    !(eccentricity >= 0 && eccentricity < 1) ||
    typeof meanAnomalyAtEpoch !== "number" ||
    !Number.isFinite(meanAnomalyAtEpoch) ||
    typeof epoch !== "number" ||
    !Number.isFinite(epoch) ||
    typeof ut !== "number" ||
    !Number.isFinite(ut)
  ) {
    return null;
  }
  // inc/lan/argPe don't affect the anomaly solve: pass zero for them.
  const { trueAnomaly } = solveAnomalies(
    {
      sma: semiMajorAxis,
      ecc: eccentricity,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch,
      epoch,
      mu: parentGravParameter,
    },
    ut,
  );
  const deg = (trueAnomaly * 180) / Math.PI;
  const wrapped = deg % 360;
  return finite(wrapped < 0 ? wrapped + 360 : wrapped);
}
