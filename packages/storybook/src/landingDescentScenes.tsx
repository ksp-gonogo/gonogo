import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  integrateAtmosphere,
  LOW_DESCENT,
} from "../../components/scripts/landingAtmosphereModel";
import {
  integrate,
  SHALLOW_DESCENT,
} from "../../components/scripts/landingDescentModel";
import type { ProbeMount } from "../../components/scripts/probe/probe-entry";
import {
  AIR,
  crashEmits,
  emitsOf,
  landsAtSea,
  playbackOf,
  type StoryWorld,
  streamOf,
} from "../scripts/landingPlaybackModel";
import { DEFAULT_SIZE } from "../scripts/landingStorySize";
import { PlaybackStart } from "./PlaybackStart";
import { WidgetScene } from "./WidgetScene";

/** Descent seconds played per real second. */
const PLAYBACK_RATE = 10;
/** Real seconds the last scene is held on screen before the story ends. */
const HOLD_SECONDS = 3;
/** Real seconds a crash is held on its impact, long enough to read where the vessel came to rest. */
const CRASH_HOLD_SECONDS = 8;

export interface LandingDescentSceneProps {
  /** Comes in too fast and meets the ground, instead of burning down to a soft touchdown. */
  crash?: boolean;
  /** Begins as a shallow approach: low and slow, under five degrees below level, instead of the deep descent from 8 km. */
  shallow?: boolean;
  /** Where the descent takes place; the Mun when omitted. */
  world?: StoryWorld;
  w?: number;
  h?: number;
}

/**
 * Landing Status mounted on the first frame of a synthetic Mun descent, then
 * fed every later frame in turn at a fixed playback rate, so the altitude rail
 * and the rest of the widget can be watched reacting. Replay starts it over.
 */
export function LandingDescentScene({
  crash = false,
  shallow = false,
  world = "mun",
  w = DEFAULT_SIZE.w,
  h = DEFAULT_SIZE.h,
}: LandingDescentSceneProps) {
  const all = useMemo(
    () =>
      world === "mun"
        ? integrate({ crash, start: shallow ? SHALLOW_DESCENT : undefined })
        : integrateAtmosphere(
            AIR[world],
            landsAtSea(world) ? LOW_DESCENT : undefined,
          ),
    [crash, shallow, world],
  );
  const { played: frames, streamEnds } = useMemo(
    () => playbackOf(all, crash),
    [all, crash],
  );
  const first = useMemo(() => {
    return streamOf(
      frames[0],
      world,
      crash
        ? "Comes in too fast and meets the ground."
        : "Burns down to a soft touchdown.",
    );
  }, [frames, crash, world]);
  const [run, setRun] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => () => clearInterval(timer.current), []);

  const play = useCallback(
    (mount: ProbeMount) => {
      let index = 0;
      clearInterval(timer.current);
      timer.current = setInterval(() => {
        index += 1;
        const frame = frames[index];
        if (!frame) {
          clearInterval(timer.current);
          // The vessel is gone: nothing more arrives, so the widget holds the last scene as last seen.
          if (streamEnds) {
            for (const e of crashEmits(all[all.length - 1]))
              mount.emit(e.channel, e.value, e.meta);
            void mount.stopArriving();
          }
          return;
        }
        for (const e of emitsOf(frame, world))
          mount.emit(e.channel, e.value, e.meta);
        setElapsed(Math.floor(frame.t));
      }, 1000 / PLAYBACK_RATE);
    },
    [all, frames, streamEnds, world],
  );

  const replay = () => {
    clearInterval(timer.current);
    setElapsed(0);
    setRun((n) => n + 1);
  };

  return (
    // The running time a picture of this story must cover: the whole descent and the hold on its end.
    <div
      data-story-seconds={Math.ceil(
        frames.length / PLAYBACK_RATE +
          (streamEnds ? CRASH_HOLD_SECONDS : HOLD_SECONDS),
      )}
    >
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <PlaybackStart onClick={replay}>Replay</PlaybackStart>
        <span aria-live="off">
          Descent clock T+{elapsed} of T+{all[all.length - 1].t}, played at{" "}
          {PLAYBACK_RATE} times speed
        </span>
      </div>
      <WidgetScene
        key={`${crash}-${shallow}-${world}-${run}`}
        widgetId="landing-status"
        fixture={first}
        w={w}
        h={h}
        onMounted={play}
      />
    </div>
  );
}
