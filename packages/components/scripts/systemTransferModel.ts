/**
 * A craft coasting from low Kerbin orbit to the Mun, as System View is shown it:
 * the Hohmann ellipse the injection burn leaves it on, and the instants the
 * playback walks the view clock through. The conic and the bodies never change
 * once the burn is done; only the instant does, so the bodies, the craft and
 * the phase angle between them all move off the one clock.
 */
import fixture from "../src/SystemView/__fixtures__/kerbin-mun-encounter.json";
import {
  firstScene,
  type PlaybackEmit,
  type PlaybackFrame,
  stampedAt,
} from "./playbackFrame";

export const KERBIN_MU = 3.5316e12;
export const PARKING_RADIUS = 700_000;
export const MUN_ORBIT_RADIUS = 12_000_000;

/** Story seconds of view clock per real second. */
export const TRANSFER_RATE = 600;
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

/** Where the craft's conic enters the Mun's sphere of influence, from the fixture's own encounter record. */
export const ENCOUNTER_UT = (
  fixture._stream.emits.find((e) => e.channel === "vessel.orbit")?.value as {
    encounter: { transitionUt: number };
  }
).encounter.transitionUt;

const orbitTemplate = fixture._stream.emits.find(
  (e) => e.channel === "vessel.orbit",
) as { value: Record<string, unknown>; meta: Record<string, unknown> };

/** The conic as the game restarts it each update: the same ellipse, with its epoch and anomaly moved to `ut`. */
export function orbitAt(ut: number): {
  epoch: number;
  meanAnomalyAtEpoch: number;
} & Record<string, unknown> {
  const { sma } = hohmann(KERBIN_MU, PARKING_RADIUS, MUN_ORBIT_RADIUS);
  const meanMotion = Math.sqrt(KERBIN_MU / sma ** 3);
  return {
    ...orbitTemplate.value,
    epoch: ut,
    meanAnomalyAtEpoch: (meanMotion * ut) % (2 * Math.PI),
  };
}

interface CatalogueBody {
  name: string;
  orbit: Record<string, unknown> | null;
}

const catalogue = fixture._stream.emits.find(
  (e) => e.channel === "system.bodies",
) as { value: { bodies: CatalogueBody[] } };

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
 * playback rate it does inside a second.
 */
function keyframesAt(ut: number): PlaybackEmit[] {
  return fixture._stream.emits
    .filter((e) => e.channel !== "vessel.orbit")
    .map((e) =>
      stampedAt(
        e.channel,
        e.channel === "system.bodies" ? TILTED_CATALOGUE : e.value,
        ut,
        (e as { meta?: Record<string, unknown> }).meta,
      ),
    );
}

function emitsAt(ut: number): PlaybackEmit[] {
  return [
    stampedAt("vessel.orbit", orbitAt(ut), ut, orbitTemplate.meta),
    ...keyframesAt(ut),
  ];
}

function clockLine(ut: number): string {
  const hours = ut / 3600;
  return `Transfer clock T+${hours.toFixed(1)} h of T+${(ENCOUNTER_UT / 3600).toFixed(1)} h, played at ${TRANSFER_RATE} times speed`;
}

/** The scene System View mounts on: the craft at periapsis, the burn just done. */
export function transferFirstScene(): Record<string, unknown> {
  return firstScene(
    fixture,
    { "system.bodies": TILTED_CATALOGUE },
    "transfer-playback",
    0,
  );
}

/** One frame per tenth of a second until the craft reaches the Mun's sphere of influence. */
export function transferFrames(): PlaybackFrame[] {
  const frames: PlaybackFrame[] = [];
  for (let seconds = 0; ; seconds += FRAME_SECONDS) {
    const ut = Math.min(ENCOUNTER_UT, seconds * TRANSFER_RATE);
    frames.push({ seconds, ut, emits: emitsAt(ut), clock: clockLine(ut) });
    if (ut >= ENCOUNTER_UT) return frames;
  }
}
