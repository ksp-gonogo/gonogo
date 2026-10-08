/**
 * A craft circling Kerbin at 85 km on a 28.5 degree orbit, as Map View is
 * shown it: each frame is the position and conic the game would have sent at
 * that instant, worked out from the orbit and the planet's spin. Two orbits
 * shift the ground track west by the planet's rotation between them.
 */
import fixture from "../src/MapView/__fixtures__/kerbin-lko-equator.json";
import {
  firstScene,
  type PlaybackEmit,
  type PlaybackFrame,
  stampedAt,
} from "./playbackFrame";

export const KERBIN_MU = 3.5316e12;
export const KERBIN_RADIUS = 600_000;
export const KERBIN_ROTATION_PERIOD = 21549.425;
const ORBIT_ALTITUDE = 85_000;
export const INCLINATION = 28.5;
/** Where the craft crosses the equator northbound at the start: over the space centre. */
export const START_LONGITUDE = -74.5;
const START_UT = 1_234_567;
const ORBITS = 2;

/** Story seconds of game time per real second. */
const ORBIT_RATE = 80;
const FRAME_SECONDS = 0.25;
const DEG = Math.PI / 180;

const radius = KERBIN_RADIUS + ORBIT_ALTITUDE;
const meanMotion = Math.sqrt(KERBIN_MU / radius ** 3);
export const ORBIT_PERIOD = (2 * Math.PI) / meanMotion;
const spin = 360 / KERBIN_ROTATION_PERIOD;

function wrapLongitude(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** Latitude and longitude beneath the craft `seconds` after it crossed the ascending node. */
export function groundPoint(seconds: number): { lat: number; lon: number } {
  const u = meanMotion * seconds;
  const inc = INCLINATION * DEG;
  return {
    lat: Math.asin(Math.sin(inc) * Math.sin(u)) / DEG,
    lon: wrapLongitude(
      START_LONGITUDE +
        Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u)) / DEG -
        spin * seconds,
    ),
  };
}

const orbitTemplate = fixture._stream.emits.find(
  (e) => e.channel === "vessel.orbit",
)?.value as { patches: Record<string, unknown>[] } & Record<string, unknown>;

function orbitAt(ut: number) {
  const anomaly = (meanMotion * (ut - START_UT)) % (2 * Math.PI);
  const elements = {
    sma: radius,
    inc: INCLINATION,
    meanAnomalyAtEpoch: anomaly,
    epoch: ut,
  };
  return {
    ...orbitTemplate,
    ...elements,
    patches: [
      {
        ...orbitTemplate.patches[0],
        ...elements,
        period: ORBIT_PERIOD,
        startUt: ut,
        endUt: ut + ORBIT_PERIOD,
        peA: ORBIT_ALTITUDE,
        apA: ORBIT_ALTITUDE,
        semiLatusRectum: radius,
        semiMinorAxis: radius,
      },
    ],
  };
}

function flightAt(ut: number) {
  const { lat, lon } = groundPoint(ut - START_UT);
  const orbital = Math.sqrt(KERBIN_MU / radius);
  return {
    ...(fixture._stream.emits.find((e) => e.channel === "vessel.flight")
      ?.value as Record<string, unknown>),
    latitude: lat,
    longitude: lon,
    orbitalSpeed: orbital,
    surfaceSpeed:
      orbital -
      (2 * Math.PI * radius * Math.cos(INCLINATION * DEG)) /
        KERBIN_ROTATION_PERIOD,
  };
}

function emitsAt(ut: number): PlaybackEmit[] {
  return [
    stampedAt("vessel.orbit", orbitAt(ut), ut, { quality: 1 }),
    stampedAt("vessel.flight", flightAt(ut), ut),
  ];
}

/** The scene Map View mounts on: the craft at the equator crossing. */
export function orbitFirstScene(): Record<string, unknown> {
  return firstScene(
    fixture,
    {
      "vessel.orbit": orbitAt(START_UT),
      "vessel.flight": flightAt(START_UT),
    },
    "orbit-playback",
    START_UT,
  );
}

/** One frame per quarter of a second, from the node crossing to the end of the last orbit. */
export function orbitFrames(): PlaybackFrame[] {
  const total = ORBITS * ORBIT_PERIOD;
  const frames: PlaybackFrame[] = [];
  for (let seconds = 0; ; seconds += FRAME_SECONDS) {
    const elapsed = Math.min(total, seconds * ORBIT_RATE);
    const ut = START_UT + elapsed;
    frames.push({
      seconds,
      ut,
      emits: emitsAt(ut),
      clock: `Orbit ${elapsed / ORBIT_PERIOD + 1 > ORBITS ? ORBITS : Math.floor(elapsed / ORBIT_PERIOD) + 1} of ${ORBITS}, T+${Math.round(elapsed / 60)} min, played at ${ORBIT_RATE} times speed`,
    });
    if (elapsed >= total) return frames;
  }
}
