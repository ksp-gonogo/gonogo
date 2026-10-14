import {
  openOrbitArc,
  orbitRing,
  rotatePerifocalToInertial,
  type Vec3Tuple,
} from "@ksp-gonogo/sitrep-client";

/** Keplerian orbit geometry in the parent's inertial frame, metres. */

const RAD = Math.PI / 180;

function clampEcc(eccentricity: number): number {
  return Math.min(Math.max(eccentricity, 0), 0.999);
}

/** How many periapsis radii an open orbit is drawn out to about a body that states no sphere of influence. */
const OPEN_ARC_PERIAPSES = 8;

/**
 * How far from the parent's centre an open orbit is drawn, metres: the sphere of influence it is inside, since the orbit holds no further, or a fixed multiple of its periapsis about a body that states none.
 * Null for an orbit that is not open or whose elements give no periapsis.
 */
export function openOrbitReach(
  sma: number,
  eccentricity: number,
  soi: number | null | undefined,
): number | null {
  if (!(eccentricity > 1)) return null;
  const periapsis = Math.abs(sma) * (eccentricity - 1);
  if (!(periapsis > 0) || !Number.isFinite(periapsis)) return null;
  if (soi != null && Number.isFinite(soi) && soi > periapsis) return soi;
  return periapsis * OPEN_ARC_PERIAPSES;
}

/**
 * A point on a Keplerian orbit in the parent's inertial frame, metres, through the full perifocal-to-inertial rotation (argPe, then inclination, then lan).
 * An open orbit (eccentricity above 1) is placed on its hyperbola, where `sma` is negative and the semi-latus rectum `sma·(1 − e²)` is still positive.
 */
export function orbitPointAt(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  trueAnomalyDeg: number,
): Vec3Tuple {
  const e = eccentricity > 1 ? eccentricity : clampEcc(eccentricity);
  const theta = trueAnomalyDeg * RAD;
  const r = Math.abs(sma * (1 - e * e)) / (1 + e * Math.cos(theta));
  return perifocalToParent(
    r * Math.cos(theta),
    r * Math.sin(theta),
    lanDeg,
    argPeDeg,
    inclinationDeg,
  );
}

/** A perifocal offset (periapsis on `+x`, motion toward `+y`, normal on `+z`) in the parent's inertial frame, metres; `z` is kept because an integrated arc leaves the osculating plane. */
export function perifocalToParent(
  xPerifocal: number,
  yPerifocal: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  zPerifocal = 0,
): Vec3Tuple {
  return rotatePerifocalToInertial(
    xPerifocal,
    yPerifocal,
    inclinationDeg * RAD,
    lanDeg * RAD,
    argPeDeg * RAD,
    zPerifocal,
  );
}

/** The closed ring of an orbit held in degrees, in the parent's inertial frame, metres, sampled by the SDK so every widget draws the same curve. */
export function orbitRingOf(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  samples?: number,
): Vec3Tuple[] {
  return orbitRing(
    {
      sma,
      ecc: eccentricity,
      inc: inclinationDeg * RAD,
      lan: lanDeg * RAD,
      argPe: argPeDeg * RAD,
    },
    samples,
  );
}

/** The part of an open orbit held in degrees that lies within `maxRadius` metres of its parent, in the parent's inertial frame, metres, sampled by the SDK from the inbound end to the outbound one. */
export function openOrbitArcOf(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  maxRadius: number,
  samples?: number,
): Vec3Tuple[] {
  return openOrbitArc(
    {
      sma,
      ecc: eccentricity,
      inc: inclinationDeg * RAD,
      lan: lanDeg * RAD,
      argPe: argPeDeg * RAD,
    },
    maxRadius,
    samples,
  );
}
