import {
  orbitRing,
  rotatePerifocalToInertial,
  type Vec3Tuple,
} from "@ksp-gonogo/sitrep-client";

/** Keplerian orbit geometry in the parent's inertial frame, metres. */

const RAD = Math.PI / 180;

function clampEcc(eccentricity: number): number {
  return Math.min(Math.max(eccentricity, 0), 0.999);
}

/** A point on a Keplerian orbit in the parent's inertial frame, metres, through the full perifocal-to-inertial rotation (argPe, then inclination, then lan). */
export function orbitPointAt(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  trueAnomalyDeg: number,
): Vec3Tuple {
  const e = clampEcc(eccentricity);
  const theta = trueAnomalyDeg * RAD;
  const r = (sma * (1 - e * e)) / (1 + e * Math.cos(theta));
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
