import { solveAnomalies } from "./kepler";

/**
 * The two celestial-body almanac values the game has no answer for, so the
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

/**
 * The speed a vessel needs at a body's surface to leave its gravity, in m/s:
 * `v = √(2μ / r)`, from the body's gravitational parameter and radius. `null`
 * when either input is missing or not positive. Useful for showing the operator
 * the speed needed to escape a body, which the stream does not send. Used
 * alongside the other derived almanac values for a celestial body.
 */
export function deriveEscapeVelocity(
  gravParameter: number | null | undefined,
  radius: number | null | undefined,
): number | null {
  if (!isPos(gravParameter) || !isPos(radius)) return null;
  return finite(Math.sqrt((2 * gravParameter) / radius));
}

/**
 * The time one orbit takes, in seconds, from the semi-major axis and the
 * parent body's gravitational parameter: `T = 2π · √(a³ / μ_parent)`. `null`
 * when either input is missing or not positive. Useful for showing the operator
 * how long a body or vessel takes to circle its parent. Used alongside the
 * other derived almanac values for a celestial body.
 */
export function derivePeriod(
  semiMajorAxis: number | null | undefined,
  parentGravParameter: number | null | undefined,
): number | null {
  /*
   * Not taken off the wire: KSP's own Orbit.period is 2π/meanMotion over
   * meanMotion = √(μ/|a|³), so this is the game's expression.
   */
  if (!isPos(semiMajorAxis) || !isPos(parentGravParameter)) return null;
  return finite(
    2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / parentGravParameter),
  );
}

/** Whether a semi-major axis is one the anomaly solve can use: positive for a closed orbit, any finite non-zero length for an open one. A parabolic orbit has none. */
function conicHasSize(
  semiMajorAxis: number | null | undefined,
  eccentricity: number,
): semiMajorAxis is number {
  if (eccentricity >= 0 && eccentricity < 1) return isPos(semiMajorAxis);
  return (
    eccentricity > 1 &&
    typeof semiMajorAxis === "number" &&
    Number.isFinite(semiMajorAxis) &&
    semiMajorAxis !== 0
  );
}

/**
 * Where a body or vessel is along its orbit, as the true anomaly in degrees in
 * `[0, 360)`, at universal time `ut`, reconstructed from the mean anomaly at
 * epoch. Useful for placing a body or vessel on its orbit at a chosen time.
 * Used by the system view to place each body. A closed orbit needs a positive
 * semi-major axis; an open one (`ecc` above 1) is solved along its hyperbola
 * from the size of its semi-major axis, whichever sign it carries. Returns
 * `null` for a parabolic orbit (`ecc` exactly 1), a missing input, or a
 * non-finite `ut`.
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
    typeof eccentricity !== "number" ||
    !conicHasSize(semiMajorAxis, eccentricity) ||
    !isPos(parentGravParameter) ||
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
