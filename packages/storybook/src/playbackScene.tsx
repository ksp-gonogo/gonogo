import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProbeMount } from "../../components/scripts/probe/probe-entry";
import type { PlaybackScenario } from "../scripts/playbackTypes";
import { PlaybackStart } from "./PlaybackStart";
import { WidgetScene } from "./WidgetScene";

export interface PlaybackSceneProps {
  scenario: PlaybackScenario;
  w?: number;
  h?: number;
}

/**
 * A widget mounted on the first frame of a small model, then fed the model's
 * later frames in turn so it can be watched reacting. Replay starts it over.
 */
export function PlaybackScene({ scenario, w, h }: PlaybackSceneProps) {
  const { frames, stepMs, staticEmits } = scenario;
  const first = useMemo(
    () => ({
      _meta: {
        scenario: scenario.scenario,
        synthetic: true,
        notes: scenario.notes,
      },
      _stream: {
        pinnedUt: 10,
        emits: [...staticEmits, ...frames[0].emits],
      },
    }),
    [scenario, staticEmits, frames],
  );
  const [run, setRun] = useState(0);
  const [at, setAt] = useState(0);
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
          return;
        }
        for (const e of frame.emits) mount.emit(e.channel, e.value, e.meta);
        setAt(index);
      }, stepMs);
    },
    [frames, stepMs],
  );

  const replay = () => {
    clearInterval(timer.current);
    setAt(0);
    setRun((n) => n + 1);
  };

  return (
    // The running time a picture of this story must cover: every step after the first.
    <div data-story-seconds={Math.ceil(((frames.length - 1) * stepMs) / 1000)}>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <PlaybackStart onClick={replay}>Replay</PlaybackStart>
        <span aria-live="off">
          Step {at} of {frames.length - 1}: {frames[at].caption}
        </span>
      </div>
      <WidgetScene
        key={run}
        widgetId={scenario.widgetId}
        fixture={first}
        w={w ?? scenario.defaultSize.w}
        h={h ?? scenario.defaultSize.h}
        onMounted={play}
      />
    </div>
  );
}
