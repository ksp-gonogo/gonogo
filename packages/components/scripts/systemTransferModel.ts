/**
 * A craft coasting from low Kerbin orbit to the Mun, as Tracking Station is shown it:
 * the Hohmann ellipse the injection burn leaves it on, the capture burn that
 * binds it to the Mun where its conic crosses the Mun's sphere of influence, and
 * the instants the playback walks the view clock through. A conic never changes
 * once it is set; only the instant does, so the bodies, the craft and the phase
 * angle between them all move off the one clock.
 *
 * The Hohmann arrival is hyperbolic about the Mun, which the orbit model cannot
 * place a craft on, so the capture burn is taken at the sphere's edge, with the
 * craft's apoapsis there and its periapsis 250 km above the surface.
 */
import fixture from "../src/TrackingStation/__fixtures__/kerbin-mun-encounter.json";
import {
  firstScene,
  type PlaybackEmit,
  type PlaybackFrame,
  stampedAt,
} from "./playbackFrame";

export const KERBIN_MU = 3.5316e12;
export const PARKING_RADIUS = 700_000;
export const MUN_ORBIT_RADIUS = 12_000_000;

/** Story seconds of view clock per real second while the craft coasts to the Mun. */
export const TRANSFER_RATE = 600;
/** Story seconds per real second once it is in orbit about the Mun, where a revolution takes hours. */
export const CAPTURE_RATE = 1500;
/** Distance from the Mun's centre of the periapsis the capture burn leaves the craft on, metres. */
export const CAPTURE_PERIAPSIS_RADIUS = 450_000;
/** Seconds between the frames the view clock is moved on. */
const FRAME_SECONDS = 0.1;

/** The transfer ellipse tangent to both circular orbits, and how long the half-ellipse takes. */
export function hohmann(mu: number, r1: number, r2: number) {
  const sma = (r1 + r2) / 2;
  return {
    sma,
    ecc: (r2 - r1) / (r2 + r1),
    halfPeriod: Math.PI * Math.sqrt((sma * sma * sma) / mu),
  };
}

const orbitTemplate = fixture._stream.emits.find(
  (e) => e.channel === "vessel.orbit",
) as {
  value: Record<string, unknown> & {
    patches: Record<string, unknown>[];
    encounter: Record<string, unknown>;
  };
  meta: Record<string, unknown>;
};

interface CatalogueBody {
  index: number;
  name: string;
  radius: number;
  gravParameter: number;
  sphereOfInfluence?: number | null;
  orbit: Record<string, unknown> | null;
}

const catalogue = fixture._stream.emits.find(
  (e) => e.channel === "trackingStation.bodies",
) as { value: { bodies: CatalogueBody[] } };

const MUN = catalogue.value.bodies.find(
  (b) => b.name === "Mun",
) as CatalogueBody & {
  sphereOfInfluence: number;
  orbit: { sma: number; meanAnomalyAtEpoch: number };
};

type Vec = [number, number];

function eccentricAnomaly(meanAnomaly: number, ecc: number): number {
  let e = meanAnomaly;
  for (let i = 0; i < 60; i++) {
    e -= (e - ecc * Math.sin(e) - meanAnomaly) / (1 - ecc * Math.cos(e));
  }
  return e;
}

/** The craft's position and velocity about Kerbin at `ut` on the Hohmann ellipse, in the plane the system lies in. */
function craftState(ut: number): { p: Vec; v: Vec } {
  const { sma, ecc } = hohmann(KERBIN_MU, PARKING_RADIUS, MUN_ORBIT_RADIUS);
  const meanMotion = Math.sqrt(KERBIN_MU / sma ** 3);
  const e = eccentricAnomaly(meanMotion * ut, ecc);
  const r = sma * (1 - ecc * Math.cos(e));
  const speedScale = Math.sqrt(KERBIN_MU * sma) / r;
  const root = Math.sqrt(1 - ecc * ecc);
  return {
    p: [sma * (Math.cos(e) - ecc), sma * root * Math.sin(e)],
    v: [-speedScale * Math.sin(e), speedScale * root * Math.cos(e)],
  };
}

/** The Mun's position and velocity about Kerbin at `ut` on the catalogue's circular orbit. */
function munState(ut: number): { p: Vec; v: Vec } {
  const { sma, meanAnomalyAtEpoch } = MUN.orbit;
  const meanMotion = Math.sqrt(KERBIN_MU / sma ** 3);
  const angle = meanAnomalyAtEpoch + meanMotion * ut;
  return {
    p: [sma * Math.cos(angle), sma * Math.sin(angle)],
    v: [
      -sma * meanMotion * Math.sin(angle),
      sma * meanMotion * Math.cos(angle),
    ],
  };
}

/** The craft's position and velocity about the Mun, which the Hohmann conic carries unchanged until the craft is inside the Mun's sphere of influence. */
function relativeState(ut: number): { p: Vec; v: Vec } {
  const c = craftState(ut);
  const m = munState(ut);
  return {
    p: [c.p[0] - m.p[0], c.p[1] - m.p[1]],
    v: [c.v[0] - m.v[0], c.v[1] - m.v[1]],
  };
}

/** Where the craft's conic crosses into the Mun's sphere of influence: the last instant it is outside, found by bisection before the closest approach. */
export const ENCOUNTER_UT = (() => {
  let outside = 0;
  let inside = hohmann(KERBIN_MU, PARKING_RADIUS, MUN_ORBIT_RADIUS).halfPeriod;
  for (let i = 0; i < 80; i++) {
    const mid = (outside + inside) / 2;
    const [x, y] = relativeState(mid).p;
    if (Math.hypot(x, y) > MUN.sphereOfInfluence) outside = mid;
    else inside = mid;
  }
  return inside;
})();

/** The orbit about the Mun the capture burn leaves: apoapsis at the sphere's edge where the burn is taken, periapsis `CAPTURE_PERIAPSIS_RADIUS` from its centre, prograde. */
const capture = (() => {
  const apoapsis = MUN.sphereOfInfluence;
  const sma = (CAPTURE_PERIAPSIS_RADIUS + apoapsis) / 2;
  const [x, y] = relativeState(ENCOUNTER_UT).p;
  return {
    sma,
    ecc:
      (apoapsis - CAPTURE_PERIAPSIS_RADIUS) /
      (apoapsis + CAPTURE_PERIAPSIS_RADIUS),
    period: 2 * Math.PI * Math.sqrt(sma ** 3 / MUN.gravParameter),
    meanMotion: Math.sqrt(MUN.gravParameter / sma ** 3),
    /** Periapsis lies opposite the burn, degrees. */
    argPe: ((((Math.atan2(y, x) * 180) / Math.PI + 180) % 360) + 360) % 360,
  };
})();

/** How long the playback stays with the craft in orbit about the Mun: half a revolution, apoapsis to periapsis. */
export const CAPTURE_SPAN = capture.period / 2;

/** The conic as the game restarts it each update: the same ellipse, with its epoch and anomaly moved to `ut`, ending where it meets the Mun's sphere of influence. */
export function orbitAt(ut: number): {
  epoch: number;
  meanAnomalyAtEpoch: number;
} & Record<string, unknown> {
  const { sma } = hohmann(KERBIN_MU, PARKING_RADIUS, MUN_ORBIT_RADIUS);
  const meanMotion = Math.sqrt(KERBIN_MU / sma ** 3);
  const { patches, encounter } = orbitTemplate.value;
  return {
    ...orbitTemplate.value,
    epoch: ut,
    meanAnomalyAtEpoch: (meanMotion * ut) % (2 * Math.PI),
    encounter: { ...encounter, transitionUt: ENCOUNTER_UT },
    patches: patches.map((p, i) =>
      i === 0 ? { ...p, endUt: ENCOUNTER_UT } : p,
    ),
  };
}

/** The capture orbit about the Mun, restated at `ut` the same way. */
export function captureOrbitAt(ut: number): {
  sma: number;
  ecc: number;
  mu: number;
  epoch: number;
  meanAnomalyAtEpoch: number;
} & Record<string, unknown> {
  const { sma, ecc, period, meanMotion, argPe } = capture;
  const elapsed = Math.max(0, ut - ENCOUNTER_UT);
  const meanAnomaly = (Math.PI + meanMotion * elapsed) % (2 * Math.PI);
  const periapsisRadius = sma * (1 - ecc);
  const apoapsisRadius = sma * (1 + ecc);
  return {
    referenceBodyIndex: MUN.index,
    sma,
    ecc,
    inc: 0,
    lan: 0,
    argPe,
    meanAnomalyAtEpoch: meanAnomaly,
    epoch: ut,
    mu: MUN.gravParameter,
    horizon: orbitTemplate.value.horizon,
    encounter: null,
    patches: [
      {
        startUt: ut,
        endUt: ut + period,
        patchStartTransition: 0,
        patchEndTransition: 1,
        sma,
        ecc,
        inc: 0,
        lan: 0,
        argPe,
        meanAnomalyAtEpoch: meanAnomaly,
        epoch: ut,
        period,
        peA: periapsisRadius,
        apA: apoapsisRadius,
        semiLatusRectum: sma * (1 - ecc * ecc),
        semiMinorAxis: sma * Math.sqrt(1 - ecc * ecc),
        referenceBody: MUN.name,
        closestEncounterBody: null,
      },
    ],
  };
}

/**
 * The fixture's catalogue with Minmus on its stock 6 degree orbit, 78 degrees
 * round from the reference direction. The fixture itself is coplanar; the
 * playback tilts the one moon the stock system does, so the depth tint on a
 * body's ring has something to show.
 */
export const TILTED_CATALOGUE = {
  ...catalogue.value,
  bodies: catalogue.value.bodies.map((b) =>
    b.name === "Minmus" && b.orbit !== null
      ? { ...b, orbit: { ...b.orbit, inc: 6, lan: 78 } }
      : b,
  ),
};

/**
 * What the mod sends every keyframe, restated at `ut`. The catalogue is the
 * sample the aside's body figures read, and a channel that stops arriving is
 * drawn held once the view clock runs past its keyframe cadence, which at the
 * playback rate it does inside a second. Once the craft is bound to the Mun its
 * identity names the Mun as the body it is about.
 */
function keyframesAt(ut: number): PlaybackEmit[] {
  const bound = ut >= ENCOUNTER_UT;
  return fixture._stream.emits
    .filter((e) => e.channel !== "vessel.orbit")
    .map((e) => {
      let value: unknown = e.value;
      if (e.channel === "trackingStation.bodies") value = TILTED_CATALOGUE;
      if (e.channel === "vessel.identity" && bound) {
        value = { ...(e.value as object), parentBodyIndex: MUN.index };
      }
      return stampedAt(
        e.channel,
        value,
        ut,
        (e as { meta?: Record<string, unknown> }).meta,
      );
    });
}

function emitsAt(ut: number): PlaybackEmit[] {
  const orbit = ut >= ENCOUNTER_UT ? captureOrbitAt(ut) : orbitAt(ut);
  return [
    stampedAt("vessel.orbit", orbit, ut, orbitTemplate.meta),
    ...keyframesAt(ut),
  ];
}

function clockLine(ut: number): string {
  const hours = (ut / 3600).toFixed(1);
  if (ut >= ENCOUNTER_UT) {
    return `Capture orbit about the Mun at T+${hours} h, played at ${CAPTURE_RATE} times speed`;
  }
  return `Transfer clock T+${hours} h of T+${(ENCOUNTER_UT / 3600).toFixed(1)} h, played at ${TRANSFER_RATE} times speed`;
}

/** The scene Tracking Station mounts on: the craft at periapsis, the burn just done. */
export function transferFirstScene(): Record<string, unknown> {
  return firstScene(
    fixture,
    { "trackingStation.bodies": TILTED_CATALOGUE, "vessel.orbit": orbitAt(0) },
    "transfer-playback",
    0,
  );
}

/** The story second at which the craft reaches the Mun's sphere of influence. */
export const CAPTURE_SECONDS = ENCOUNTER_UT / TRANSFER_RATE;

/**
 * One frame per tenth of a second: the coast to the Mun's sphere of influence
 * at `TRANSFER_RATE`, then the capture orbit from apoapsis to periapsis at
 * `CAPTURE_RATE`.
 */
export function transferFrames(): PlaybackFrame[] {
  const frames: PlaybackFrame[] = [];
  const end = CAPTURE_SECONDS + CAPTURE_SPAN / CAPTURE_RATE;
  for (let tick = 0; ; tick++) {
    const seconds = Math.min(end, tick * FRAME_SECONDS);
    const ut =
      seconds <= CAPTURE_SECONDS
        ? seconds * TRANSFER_RATE
        : ENCOUNTER_UT + (seconds - CAPTURE_SECONDS) * CAPTURE_RATE;
    frames.push({ seconds, ut, emits: emitsAt(ut), clock: clockLine(ut) });
    if (seconds >= end) return frames;
  }
}
