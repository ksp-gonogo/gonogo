/**
 * What a Landing Status descent story plays and how it ends, free of React so it can be tested.
 */
import {
  type AtmosphereFrame,
  type AtmosphereWorld,
  atmosphereStream,
  EVE_AIR,
} from "../../components/scripts/landingAtmosphereModel";
import {
  channelsFor,
  type Frame,
  streamFixture,
} from "../../components/scripts/landingDescentModel";

/** The most the craft may fall between two frames played, metres, once it is within sight of the ground. */
export const MAX_STEP_METERS = 20;
/** The height below which frames are added between the descent's own, metres: above it the fall is slow on the picture's own scale. */
const REFINE_BELOW_METERS = 1_000;

/**
 * Frames added between each pair of the descent's own, below a thousand metres, by interpolating the flight figures, so the craft never covers more than `MAX_STEP_METERS` between two frames played. The descent itself is integrated once a second, which at 140 m/s is a jump the picture cannot follow.
 */
function refined(frames: readonly Frame[]): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i];
    out.push(a);
    const b = frames[i + 1];
    if (!b || a.landed || a.aglMeters > REFINE_BELOW_METERS) continue;
    const steps = Math.ceil(
      Math.abs(a.aglMeters - b.aglMeters) / MAX_STEP_METERS,
    );
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      // Every figure that moves is carried part of the way to the next frame; what is a state (burning, landed) stays the earlier frame's.
      const between: Record<string, number> = {};
      for (const [key, from] of Object.entries(a)) {
        const to: unknown = Reflect.get(b, key);
        if (typeof from === "number" && typeof to === "number") {
          between[key] = from + (to - from) * u;
        }
      }
      out.push({ ...a, ...between });
    }
  }
  return out;
}

/**
 * The frames a story plays and, for a crash, whether it ends with the stream stopping. A safe landing is played through to the touchdown. A crash is played to the last frame before the ground: the vessel is destroyed between two readings, so its flight figures stop short of the impact and the crash report (see {@link crashEmits}) is what places it on the ground.
 */
export function playbackOf(
  frames: readonly Frame[],
  crash: boolean,
): { played: readonly Frame[]; streamEnds: boolean } {
  return crash
    ? { played: refined(frames.slice(0, -1)), streamEnds: true }
    : { played: refined(frames), streamEnds: false };
}

/** The crash report a destroyed vessel leaves, from the frame that met the ground: where it came to rest, and the flag that says a crash is on record. */
export function crashEmits(impact: Frame): Emit[] {
  const ch = channelsFor(impact, ONE_WAY_SECONDS);
  const flight = ch["vessel.flight"] as Record<string, unknown>;
  return [
    { channel: "crash.hasRecent", value: { recent: true } },
    {
      channel: "crash.lastCrash",
      value: {
        vesselId: "synthetic-lander",
        vesselName: "Synthetic Lander",
        eventKind: "Crash",
        body: "Mun",
        latitude: flight.latitude,
        longitude: flight.longitude,
        altitude: flight.altitudeAsl,
        situation: "FLYING",
      },
    },
  ];
}

/** Where a story's descent takes place: the Mun, Kerbin's air over land or over the sea, or Eve's over its sea. */
export type StoryWorld = "mun" | "kerbin-land" | "kerbin-ocean" | "eve-ocean";

export const AIR: Record<Exclude<StoryWorld, "mun">, AtmosphereWorld> = {
  "kerbin-land": { ocean: false },
  "kerbin-ocean": { ocean: true },
  "eve-ocean": { ocean: true, body: EVE_AIR },
};

/** Whether a story's descent is the low one, onto the sea. */
export function landsAtSea(world: StoryWorld): boolean {
  return world === "kerbin-ocean" || world === "eve-ocean";
}

/** The light-time to the craft every story is played under, seconds. */
export const ONE_WAY_SECONDS = 4;

/** One Topic payload a frame puts on the stream. */
export interface Emit {
  channel: string;
  value: unknown;
  meta?: Record<string, unknown>;
}

function isAirFrame(frame: Frame): frame is AtmosphereFrame {
  return "canopy" in frame;
}

/** The scene a frame of a story is, as a fixture a widget can mount: `notes` is its prose. */
export function streamOf(
  frame: Frame,
  world: StoryWorld,
  notes: string,
): { _stream: { emits: Emit[] } } {
  const fixture =
    world !== "mun" && isAirFrame(frame)
      ? atmosphereStream(frame, ONE_WAY_SECONDS, AIR[world], "descent", notes)
      : streamFixture(frame, ONE_WAY_SECONDS, "descent", notes);
  return fixture as { _stream: { emits: Emit[] } };
}

/** What a frame of a story puts on the stream. */
export function emitsOf(frame: Frame, world: StoryWorld): Emit[] {
  return streamOf(frame, world, "")._stream.emits;
}
