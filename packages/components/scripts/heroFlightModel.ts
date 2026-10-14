/**
 * One flight from the pad to a circular orbit, modelled once and read by every
 * panel of the README's hero dashboard: altitude, speed, attitude, fuel in each
 * stage, the position over the ground and the orbit all come out of the same
 * integration, so no panel shows a figure the others contradict.
 *
 * The craft is a point mass in a non-rotating frame about Kerbin, launched
 * east-north-east from the space centre with the planet's spin in its starting
 * velocity. Three stages fire in turn: a booster that flies the gravity turn, a
 * sustainer that raises the apoapsis, and an orbital stage that circularises.
 * Drag is a single exponential atmosphere. Guidance is a pitch programme, not a
 * pilot: it holds the craft on its velocity vector through the thick air, then
 * trims the pitch so the apoapsis arrives at the target altitude.
 */

export const KERBIN_MU = 3.5316e12;
export const KERBIN_RADIUS = 600_000;
export const KERBIN_ROTATION_PERIOD = 21_549.425;
export const SPACE_CENTRE = { lat: -0.0972, lon: -74.5575 };
const G0 = 9.80665;
const DEG = Math.PI / 180;
const OMEGA = (2 * Math.PI) / KERBIN_ROTATION_PERIOD;
const TARGET_APOAPSIS = 86_000;
const TARGET_PERIAPSIS = 82_000;
const LAUNCH_HEADING = 76;

/** Universal time of lift-off, so every instant of the flight is a plausible game clock. */
export const LAUNCH_UT = 1_204_800;

/** Scale height and surface density of the single exponential atmosphere. */
const SCALE_HEIGHT = 5600;
const SEA_LEVEL_DENSITY = 1.225;
/** Drag area times drag coefficient, in square metres. */
const DRAG_AREA = 3.1;

export interface StageSpec {
  /** KSP's stage number: the highest fires first. */
  stage: number;
  name: string;
  dryMass: number;
  fuelMass: number;
  thrustAsl: number;
  thrustVac: number;
  ispAsl: number;
  ispVac: number;
}

/** Tonnes, kilonewtons and seconds, as the game reports them. */
export const STAGES: readonly StageSpec[] = [
  {
    stage: 2,
    name: "Booster",
    dryMass: 1.6,
    fuelMass: 10.4,
    thrustAsl: 390,
    thrustVac: 430,
    ispAsl: 285,
    ispVac: 315,
  },
  {
    stage: 1,
    name: "Sustainer",
    dryMass: 1.1,
    fuelMass: 3.2,
    thrustAsl: 140,
    thrustVac: 215,
    ispAsl: 250,
    ispVac: 345,
  },
  {
    stage: 0,
    name: "Orbital",
    dryMass: 1.7,
    fuelMass: 1.9,
    thrustAsl: 30,
    thrustVac: 60,
    ispAsl: 250,
    ispVac: 345,
  },
];

/** The liquid fuel to oxidiser split of a stock engine's propellant, by mass. */
export const LF_FRACTION = 0.45;

type Vec3 = [number, number, number];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / norm(a));

/** One instant of the flight, everything the panels draw already worked out. */
export interface FlightSample {
  /** Seconds since lift-off. */
  t: number;
  ut: number;
  altitude: number;
  latitude: number;
  longitude: number;
  /** Speed relative to the rotating surface, and to the inertial frame, in m/s. */
  surfaceSpeed: number;
  orbitalSpeed: number;
  verticalSpeed: number;
  mass: number;
  throttle: number;
  /** Index into `STAGES` of the stage burning, or its length once every one is spent. */
  active: number;
  /** Fuel left in each stage's tanks, tonnes. */
  fuel: number[];
  /** Flight-path angle, heading and roll the navball shows. */
  pitch: number;
  heading: number;
  roll: number;
  dynamicPressure: number;
  density: number;
  mach: number;
  gForce: number;
  elements: Elements;
  /** True once an upper stage has separated this step, for the frame that carries the event. */
  staged: boolean;
  /** Stage number the craft is on, as `vessel.structure.currentStage` reports it. */
  currentStage: number;
  sas: boolean;
  rcs: boolean;
  /** Action group 1 (fairing) and 2 (solar panels) states. */
  groups: [boolean, boolean];
}

export interface Elements {
  sma: number;
  ecc: number;
  /** Degrees. */
  inc: number;
  lan: number;
  argPe: number;
  /** Radians. */
  meanAnomaly: number;
  periapsisAlt: number;
  apoapsisAlt: number;
  period: number;
  /** Seconds from now to the next periapsis and apoapsis. */
  timeToPeriapsis: number;
  timeToApoapsis: number;
}

/** Orbital elements of an inertial state about Kerbin. */
export function elementsOf(r: Vec3, v: Vec3): Elements {
  const rm = norm(r);
  const vm2 = dot(v, v);
  const h = cross(r, v);
  const hm = norm(h);
  const sma = 1 / (2 / rm - vm2 / KERBIN_MU);
  const eVec = sub(mul(cross(v, h), 1 / KERBIN_MU), mul(r, 1 / rm));
  const ecc = norm(eVec);
  const inc = Math.acos(Math.min(1, Math.max(-1, h[2] / hm)));
  const nodeVec: Vec3 = [-h[1], h[0], 0];
  const nodeMag = norm(nodeVec);
  let lan = 0;
  if (nodeMag > 1e-9) {
    lan = Math.acos(Math.min(1, Math.max(-1, nodeVec[0] / nodeMag)));
    if (nodeVec[1] < 0) lan = 2 * Math.PI - lan;
  }
  let argPe = 0;
  if (ecc > 1e-9) {
    if (nodeMag > 1e-9) {
      argPe = Math.acos(
        Math.min(1, Math.max(-1, dot(nodeVec, eVec) / (nodeMag * ecc))),
      );
      if (eVec[2] < 0) argPe = 2 * Math.PI - argPe;
    } else {
      argPe = Math.atan2(eVec[1], eVec[0]);
      if (h[2] < 0) argPe = 2 * Math.PI - argPe;
    }
  }
  let trueAnomaly = 0;
  if (ecc > 1e-9) {
    trueAnomaly = Math.acos(
      Math.min(1, Math.max(-1, dot(eVec, r) / (ecc * rm))),
    );
    if (dot(r, v) < 0) trueAnomaly = 2 * Math.PI - trueAnomaly;
  }
  const eccAnomaly =
    2 *
    Math.atan2(
      Math.sqrt(1 - ecc) * Math.sin(trueAnomaly / 2),
      Math.sqrt(1 + ecc) * Math.cos(trueAnomaly / 2),
    );
  let meanAnomaly = eccAnomaly - ecc * Math.sin(eccAnomaly);
  meanAnomaly = ((meanAnomaly % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const period = sma > 0 ? 2 * Math.PI * Math.sqrt(sma ** 3 / KERBIN_MU) : 0;
  const n = sma > 0 ? (2 * Math.PI) / period : 0;
  const wrap = (x: number) =>
    ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return {
    sma,
    ecc,
    inc: inc / DEG,
    lan: lan / DEG,
    argPe: argPe / DEG,
    meanAnomaly,
    periapsisAlt: sma * (1 - ecc) - KERBIN_RADIUS,
    apoapsisAlt: sma * (1 + ecc) - KERBIN_RADIUS,
    period,
    timeToPeriapsis: n > 0 ? wrap(2 * Math.PI - meanAnomaly) / n : 0,
    timeToApoapsis: n > 0 ? wrap(Math.PI - meanAnomaly) / n : 0,
  };
}

const STEP = 0.05;
const SAMPLE_EVERY = 1;
/** Seconds of coast carried on after the circularisation burn. */
export const COAST_SECONDS = 1_500;
/** Seconds of the burn's own length before the apoapsis it is centred on. */
const IGNITION_LEAD = 34;

function atmosphere(altitude: number): number {
  return altitude > 70_000
    ? 0
    : SEA_LEVEL_DENSITY * Math.exp(-altitude / SCALE_HEIGHT);
}

function wrapDegrees(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

type Phase = "ascent" | "coast" | "circularise" | "orbit";

/**
 * The whole flight, one sample a second of game time: pad, ascent, coast to
 * apoapsis, the circularisation burn and a long coast round the orbit.
 */
export function simulateFlight(): FlightSample[] {
  const out: FlightSample[] = [];
  const lat0 = SPACE_CENTRE.lat * DEG;
  const lon0 = SPACE_CENTRE.lon * DEG;
  let r: Vec3 = mul(
    [
      Math.cos(lat0) * Math.cos(lon0),
      Math.cos(lat0) * Math.sin(lon0),
      Math.sin(lat0),
    ],
    KERBIN_RADIUS + 70,
  );
  const spin: Vec3 = [0, 0, OMEGA];
  let v: Vec3 = cross(spin, r);
  const fuel = STAGES.map((s) => s.fuelMass);
  let active = 0;
  let throttle = 0;
  let t = 0;
  let nextSample = 0;
  let stagedFlag = false;
  let phase: Phase = "ascent";
  let kicked = false;
  let orbitReachedAt = Infinity;
  let attitudePitch = 90;
  let attitudeHeading = LAUNCH_HEADING;
  let felt = 0;
  const groups: [boolean, boolean] = [false, false];

  const massNow = () => {
    let m = 0;
    for (let i = active; i < STAGES.length; i++) {
      m += STAGES[i].dryMass + fuel[i];
    }
    return m;
  };
  const pressureRatio = (altitude: number) =>
    Math.exp(-Math.max(altitude, 0) / SCALE_HEIGHT);
  const thrustNow = (altitude: number, thr: number): number => {
    if (active >= STAGES.length) return 0;
    const s = STAGES[active];
    const p = pressureRatio(altitude);
    return (s.thrustVac + (s.thrustAsl - s.thrustVac) * p) * thr * 1000;
  };
  const ispNow = (altitude: number): number => {
    const s = STAGES[active];
    const p = pressureRatio(altitude);
    return s.ispVac + (s.ispAsl - s.ispVac) * p;
  };

  const sample = () => {
    const rm = norm(r);
    const altitude = rm - KERBIN_RADIUS;
    const up = unit(r);
    const vSurface = sub(v, cross(spin, r));
    const verticalSpeed = dot(vSurface, up);
    const rho = atmosphere(altitude);
    const speedSurface = norm(vSurface);
    const lonInertial = Math.atan2(r[1], r[0]);
    out.push({
      t,
      ut: LAUNCH_UT + t,
      altitude,
      latitude: Math.asin(up[2]) / DEG,
      longitude: wrapDegrees((lonInertial - OMEGA * t) / DEG),
      surfaceSpeed: speedSurface,
      orbitalSpeed: norm(v),
      verticalSpeed,
      mass: massNow(),
      throttle,
      active,
      fuel: [...fuel],
      pitch: attitudePitch,
      heading: attitudeHeading,
      roll: t < 8 ? 90 : t < 20 ? 90 * (1 - (t - 8) / 12) : 0,
      dynamicPressure: (0.5 * rho * speedSurface ** 2) / 1000,
      density: rho,
      mach: speedSurface / (altitude < 20_000 ? 320 : 280),
      gForce: felt / G0,
      elements: elementsOf(r, v),
      staged: stagedFlag,
      currentStage: active < STAGES.length ? STAGES[active].stage : 0,
      sas: t > 4,
      rcs: phase === "circularise" || phase === "orbit",
      groups: [...groups] as [boolean, boolean],
    });
    stagedFlag = false;
  };

  for (;;) {
    if (t >= nextSample - 1e-9) {
      sample();
      nextSample += SAMPLE_EVERY;
    }
    if (t > orbitReachedAt + COAST_SECONDS) break;

    const rm = norm(r);
    const altitude = rm - KERBIN_RADIUS;
    const up = unit(r);
    const vSurface = sub(v, cross(spin, r));
    const east = unit(cross([0, 0, 1], up));
    const north = cross(up, east);
    const vertical = dot(vSurface, up);
    const hVel = sub(vSurface, mul(up, vertical));
    const hSpeed = norm(hVel);
    const el = elementsOf(r, v);

    if (active < STAGES.length && fuel[active] <= 1e-6) {
      active += 1;
      stagedFlag = true;
    }

    let pitchCmd = 90;
    throttle = 0;
    let headingDir: Vec3 = add(
      mul(north, Math.cos(LAUNCH_HEADING * DEG)),
      mul(east, Math.sin(LAUNCH_HEADING * DEG)),
    );
    if (hSpeed > 30 && kicked) headingDir = unit(hVel);

    switch (phase) {
      case "ascent": {
        throttle = t < 3 ? Math.min(1, 0.4 + t * 0.2) : 1;
        if (altitude > 7_000 && altitude < 15_000 && active === 0) {
          throttle *=
            1 - 0.28 * Math.sin((Math.PI * (altitude - 7_000)) / 8_000);
        }
        if (!kicked && vertical > 55) kicked = true;
        if (kicked) {
          const flightPath = Math.atan2(vertical, hSpeed) / DEG;
          const programme = 90 - 85 * Math.min(1, altitude / 70_000) ** 0.6;
          pitchCmd = altitude < 900 ? 84 : Math.min(flightPath, programme);
        }
        if (active >= 1 && el.apoapsisAlt >= TARGET_APOAPSIS) {
          // Hold the apoapsis on target while the thin air still drags it down.
          throttle =
            altitude < 70_000
              ? Math.max(
                  0,
                  Math.min(1, (TARGET_APOAPSIS + 600 - el.apoapsisAlt) / 600),
                )
              : 0;
          if (altitude >= 70_000) phase = "coast";
        }
        break;
      }
      case "coast":
        pitchCmd = Math.atan2(vertical, Math.max(hSpeed, 1)) / DEG;
        if (el.timeToApoapsis <= IGNITION_LEAD) phase = "circularise";
        break;
      case "circularise":
        throttle = 1;
        // Burn along the horizon, trimming the climb rate to nothing.
        pitchCmd = Math.max(-12, Math.min(12, -vertical * 0.15));
        if (el.periapsisAlt >= TARGET_PERIAPSIS) {
          phase = "orbit";
          orbitReachedAt = t;
        }
        break;
      default:
        pitchCmd = Math.atan2(vertical, Math.max(hSpeed, 1)) / DEG;
    }

    const p = pitchCmd * DEG;
    const dir = add(mul(headingDir, Math.cos(p)), mul(up, Math.sin(p)));
    attitudePitch = pitchCmd;
    attitudeHeading =
      (Math.atan2(dot(headingDir, east), dot(headingDir, north)) / DEG + 360) %
      360;

    const thrust = thrustNow(altitude, throttle);
    const mass = massNow() * 1000;
    const gravity = mul(r, -KERBIN_MU / rm ** 3);
    const rho = atmosphere(altitude);
    const speedSurface = norm(vSurface);
    const drag: Vec3 =
      speedSurface > 0
        ? mul(vSurface, (-0.5 * rho * DRAG_AREA * speedSurface) / mass)
        : [0, 0, 0];
    const proper = add(mul(dir, thrust / mass), drag);
    felt = norm(proper);
    v = add(v, mul(add(gravity, proper), STEP));
    r = add(r, mul(v, STEP));
    if (active < STAGES.length && thrust > 0) {
      const flow = thrust / (ispNow(altitude) * G0) / 1000;
      fuel[active] = Math.max(0, fuel[active] - flow * STEP);
    }
    if (altitude > 38_000) groups[0] = true;
    if (phase === "orbit" && t > orbitReachedAt + 20) groups[1] = true;
    t = Math.round((t + STEP) * 1e6) / 1e6;
  }
  return out;
}
