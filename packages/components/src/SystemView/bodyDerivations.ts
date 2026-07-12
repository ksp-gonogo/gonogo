import { solveAnomalies } from "@ksp-gonogo/sitrep-client";

/**
 * Pure client-side derivations for the celestial-body almanac values that the
 * `system.bodies` stream deliberately does NOT put on the wire (see the
 * contract's `BodyEntry` doc). Everything here is reconstructed from the two
 * primitives the stream DOES carry — the standard gravitational parameter
 * `μ = G·M` and the body's radius — plus its Keplerian orbit. Keeping these
 * off the wire is the whole point of the "gravParameter is the one primitive"
 * design; this module is where the client pays for that.
 *
 * All inputs are nullable (the stream drops any value the live game hasn't
 * populated); every helper returns `null` rather than a NaN when it can't
 * compute a finite result, so a consumer can treat "unknown" as a single
 * state.
 */

/** Newtonian gravitational constant, m³·kg⁻¹·s⁻² (CODATA — the value KSP uses). */
export const GRAVITATIONAL_CONSTANT = 6.6743e-11;

/** Standard gravity g₀, m/s² — the reference KSP's surface-gravity "g" unit divides by. */
export const STANDARD_GRAVITY = 9.80665;

function finite(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

function isPos(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

/** Mass, kg, from μ: `M = μ / G`. */
export function deriveMass(
  gravParameter: number | null | undefined,
): number | null {
  if (!isPos(gravParameter)) return null;
  return finite(gravParameter / GRAVITATIONAL_CONSTANT);
}

/** Surface gravity, m/s², from μ and radius: `g = μ / r²`. */
export function deriveSurfaceGravity(
  gravParameter: number | null | undefined,
  radius: number | null | undefined,
): number | null {
  if (!isPos(gravParameter) || !isPos(radius)) return null;
  return finite(gravParameter / (radius * radius));
}

/** Surface gravity expressed in g (KSP's `GeeASL`): `μ / r² / g₀`. */
export function deriveSurfaceGravityG(
  gravParameter: number | null | undefined,
  radius: number | null | undefined,
): number | null {
  const g = deriveSurfaceGravity(gravParameter, radius);
  return g === null ? null : finite(g / STANDARD_GRAVITY);
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
 * Hill-sphere radius, metres — the old Telemachus `hillSphere`, derivable from
 * the orbit and the two masses: `r ≈ a·(1 − e)·∛(m / 3M)`. `null` when any
 * input is missing.
 */
export function deriveHillSphere(
  semiMajorAxis: number | null | undefined,
  eccentricity: number | null | undefined,
  mass: number | null | undefined,
  parentMass: number | null | undefined,
): number | null {
  if (
    !isPos(semiMajorAxis) ||
    !isPos(mass) ||
    !isPos(parentMass) ||
    typeof eccentricity !== "number" ||
    !Number.isFinite(eccentricity)
  ) {
    return null;
  }
  const e = Math.min(Math.max(eccentricity, 0), 0.999);
  return finite(semiMajorAxis * (1 - e) * Math.cbrt(mass / (3 * parentMass)));
}

/**
 * True anomaly, DEGREES in `[0, 360)`, at universal time `ut` — reconstructed
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
  // inc/lan/argPe don't affect the anomaly solve — pass zero for them.
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
