import type { Vector3 } from "@ksp-gonogo/sitrep-client";

/** Keplerian orbit geometry in the parent's inertial frame, metres. */

/**
 * How many points a drawn orbit ring is sampled into.
 *
 * Every ring is a sampled polyline, even under the identity projection: a projected or rotating-frame orbit is not an ellipse `cx`/`cy` can express. At 96 samples the polyline departs from the true curve by about `(pi/96)^2 / 2` of the semi-major axis, 0.16px on a 300px orbit.
 */
export const ORBIT_RING_SAMPLES = 96;

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
): Vector3 {
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
): Vector3 {
  const lan = lanDeg * RAD;
  const argPe = argPeDeg * RAD;
  const inc = inclinationDeg * RAD;
  const cosW = Math.cos(argPe);
  const sinW = Math.sin(argPe);
  const cosO = Math.cos(lan);
  const sinO = Math.sin(lan);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);
  // Rotate by argPe in the orbit plane first, so what follows is the standard node-line tilt applied to a point measured from the ascending node.
  const xn = xPerifocal * cosW - yPerifocal * sinW;
  const yn = xPerifocal * sinW + yPerifocal * cosW;
  return [
    xn * cosO - yn * sinO * cosI + zPerifocal * sinO * sinI,
    xn * sinO + yn * cosO * cosI - zPerifocal * cosO * sinI,
    yn * sinI + zPerifocal * cosI,
  ];
}

/** The whole ring of an orbit in the parent's inertial frame, metres, sampled uniformly in eccentric anomaly so points spread along the arc instead of piling up at apoapsis. */
export function orbitRingPoints(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  samples: number = ORBIT_RING_SAMPLES,
): Vector3[] {
  const e = clampEcc(eccentricity);
  const b = sma * Math.sqrt(1 - e * e);
  const points: Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const anomaly = (2 * Math.PI * i) / samples;
    points.push(
      perifocalToParent(
        sma * (Math.cos(anomaly) - e),
        b * Math.sin(anomaly),
        lanDeg,
        argPeDeg,
        inclinationDeg,
      ),
    );
  }
  return points;
}
