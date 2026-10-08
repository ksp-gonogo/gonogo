/**
 * A rocket flying a gravity turn from the pad, as the Navball is shown it: a
 * point mass thrusting along its velocity once the pitch-over kick has set it
 * off vertical, so the attitude, the throttle and the SAS mode each follow from
 * the flight rather than being keyed in. Drag is left out; the throttle dip
 * through the thick air stands in for the max-Q throttle-back a pilot flies.
 */
import fixture from "../src/Navball/__fixtures__/gravity-turn-east.json";
import {
  firstScene,
  type PlaybackEmit,
  type PlaybackFrame,
  stampedAt,
} from "./playbackFrame";

export const KERBIN_MU = 3.5316e12;
export const KERBIN_RADIUS = 600_000;
const G0 = 9.80665;
const ISP = 320;
/** Thrust over weight at lift-off, full throttle. */
const LIFTOFF_TWR = 1.5;
/** Speed at which the pilot pitches over, and by how much. */
const KICK_SPEED = 70;
const KICK_DEGREES = 5;
/** Seconds of flight the story covers, and how many play per real second. */
export const ASCENT_SECONDS = 140;
const ASCENT_RATE = 3;
const STEP = 0.1;
const FRAME_SECONDS = 1 / 6;
const DEG = Math.PI / 180;

interface AscentState {
  t: number;
  altitude: number;
  speed: number;
  /** Flight-path angle above the horizon, degrees. */
  pitch: number;
  heading: number;
  roll: number;
  throttle: number;
  /** The SAS mode the pilot has set by then. */
  sas: "off" | "StabilityAssist" | "Prograde";
}

/** Throttle through the thick air: back to 70% across the max-Q band, full either side. */
export function throttleAt(altitude: number): number {
  if (altitude < 6000 || altitude > 15_000) return 1;
  const into = (altitude - 6000) / 9000;
  return 1 - 0.3 * Math.sin(Math.PI * into);
}

/** The roll programme: pad roll of 90 degrees rolled out to 0 between t=8 and t=20. */
function rollAt(t: number): number {
  if (t < 8) return 90;
  if (t > 20) return 0;
  return 90 * (1 - (t - 8) / 12);
}

export function ascent(): AscentState[] {
  const mass0 = 1;
  const mdot = (LIFTOFF_TWR * mass0 * G0) / (ISP * G0);
  let t = 0;
  let altitude = 0;
  let speed = 0;
  let pitch = 90;
  let kicked = false;
  const out: AscentState[] = [];
  const sample = () => {
    const sas: AscentState["sas"] =
      t < 5 ? "off" : kicked && t > 25 ? "Prograde" : "StabilityAssist";
    out.push({
      t,
      altitude,
      speed,
      pitch,
      heading: 90,
      roll: rollAt(t),
      throttle: throttleAt(altitude),
      sas,
    });
  };
  sample();
  const frameEvery = Math.round(FRAME_SECONDS * ASCENT_RATE * 10) / 10;
  let sinceFrame = 0;
  while (t < ASCENT_SECONDS) {
    const r = KERBIN_RADIUS + altitude;
    const g = KERBIN_MU / (r * r);
    const throttle = throttleAt(altitude);
    const mass = mass0 - mdot * throttle * t;
    const thrust = (LIFTOFF_TWR * G0 * mass0 * throttle) / mass;
    if (!kicked && speed >= KICK_SPEED) {
      pitch = 90 - KICK_DEGREES;
      kicked = true;
    }
    const sin = Math.sin(pitch * DEG);
    const cos = Math.cos(pitch * DEG);
    speed += (thrust - g * sin) * STEP;
    altitude += speed * sin * STEP;
    if (kicked && speed > 1) {
      pitch +=
        ((-(g - (speed * speed * cos * cos) / r) * cos) / speed / DEG) * STEP;
    }
    t = Math.round((t + STEP) * 10) / 10;
    sinceFrame += STEP;
    if (sinceFrame >= frameEvery - 1e-9) {
      sample();
      sinceFrame = 0;
    }
  }
  return out;
}

const SAS_ORDINAL = { StabilityAssist: 0, Prograde: 1 } as const;

const controlTemplate = fixture._stream.emits.find(
  (e) => e.channel === "vessel.control",
)?.value as Record<string, unknown>;

function channelsAt(s: AscentState) {
  return {
    "vessel.attitude": {
      heading: s.heading,
      pitch: s.pitch,
      roll: s.roll,
      headingRootFrame: s.heading,
      pitchRootFrame: s.pitch,
      rollRootFrame: s.roll,
    },
    "vessel.control": {
      ...controlTemplate,
      sas: s.sas !== "off",
      sasMode: s.sas === "off" ? 0 : SAS_ORDINAL[s.sas],
      throttle: s.throttle,
    },
  };
}

/** The scene the Navball mounts on: the rocket on the pad, throttle up. */
export function ascentFirstScene(): Record<string, unknown> {
  return firstScene(fixture, channelsAt(ascent()[0]), "ascent-playback", 0);
}

/** One frame per sixth of a second, from lift-off to the end of the turn. */
export function ascentFrames(): PlaybackFrame[] {
  return ascent().map((s, i) => {
    const channels = channelsAt(s);
    const emits: PlaybackEmit[] = Object.entries(channels).map(([c, v]) =>
      stampedAt(c, v, s.t),
    );
    return {
      seconds: i * FRAME_SECONDS,
      ut: s.t,
      emits,
      clock: `Flight T+${Math.round(s.t)} s of T+${ASCENT_SECONDS} s, ${Math.round(s.altitude / 100) / 10} km at ${Math.round(s.speed)} m/s, played at ${ASCENT_RATE} times speed`,
    };
  });
}
