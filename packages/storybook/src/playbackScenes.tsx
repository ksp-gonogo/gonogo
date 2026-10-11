import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  orbitFirstScene,
  orbitFrames,
} from "../../components/scripts/mapOrbitModel";
import {
  ascentFirstScene,
  ascentFrames,
} from "../../components/scripts/navballAscentModel";
import type { PlaybackFrame } from "../../components/scripts/playbackFrame";
import type { ProbeMount } from "../../components/scripts/probe/probe-entry";
import {
  transferFirstScene,
  transferFrames,
} from "../../components/scripts/systemTransferModel";
import { PlaybackStart } from "./PlaybackStart";
import { WidgetScene } from "./WidgetScene";

export interface PlaybackSceneProps {
  w?: number;
  h?: number;
}

interface FramePlayerProps extends PlaybackSceneProps {
  widgetId: string;
  /** The widget's first scene, the same shape its fixtures take. */
  first: Record<string, unknown>;
  frames: readonly PlaybackFrame[];
  /** Part of the mount's key, so a story that swaps its model remounts. */
  name: string;
  /** Run once the widget has mounted, before the first frame: the presses and gestures an operator would make to set the view up. */
  setup?: (scene: HTMLElement) => void;
}

/**
 * A widget mounted on its first scene, then walked through a model's frames on
 * a timer: each frame moves the view clock to its instant and puts its samples
 * on the stream, so the widget reacts as it would live. Replay starts over.
 */
export function FramePlayer({
  widgetId,
  first,
  frames,
  name,
  setup,
  w,
  h,
}: FramePlayerProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const [clock, setClock] = useState(frames[0].clock);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => () => clearInterval(timer.current), []);

  const play = useCallback(
    (mount: ProbeMount) => {
      clearInterval(timer.current);
      if (sceneRef.current) setup?.(sceneRef.current);
      const started = performance.now();
      let index = 0;
      timer.current = setInterval(() => {
        const elapsed = (performance.now() - started) / 1000;
        while (
          index + 1 < frames.length &&
          frames[index + 1].seconds <= elapsed
        ) {
          index += 1;
          const frame = frames[index];
          mount.scrubTo(frame.ut);
          for (const e of frame.emits) mount.emit(e.channel, e.value, e.meta);
          setClock(frame.clock);
        }
        if (index + 1 >= frames.length) clearInterval(timer.current);
      }, 1000 / 30);
    },
    [frames, setup],
  );

  const replay = () => {
    clearInterval(timer.current);
    setClock(frames[0].clock);
    setRun((n) => n + 1);
  };

  return (
    // The running time a picture of this story must cover: the last frame's instant.
    <div data-story-seconds={Math.ceil(frames[frames.length - 1].seconds)}>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <PlaybackStart onClick={replay}>Replay</PlaybackStart>
        <span aria-live="off">{clock}</span>
      </div>
      <div ref={sceneRef}>
        <WidgetScene
          key={`${name}-${run}`}
          widgetId={widgetId}
          fixture={first}
          w={w ?? 12}
          h={h ?? 12}
          onMounted={play}
        />
      </div>
    </div>
  );
}

/** Following the craft and zooming in on it, as an operator would, so the burn's parking orbit and the climb away from it read at their own scale. */
function followAndZoom(scene: HTMLElement): void {
  const focus = [...scene.querySelectorAll("button")].find(
    (b) => b.textContent === "Focus vessel",
  );
  focus?.click();
  const diagram = scene.querySelector("svg[viewBox]");
  for (let notch = 0; notch < FOLLOW_ZOOM_NOTCHES; notch++) {
    diagram?.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

/** Each notch is a 1.15 times zoom. */
const FOLLOW_ZOOM_NOTCHES = 4;

/** System View following a craft from low Kerbin orbit to the Mun, the Mun and the phase angle moving as the clock runs. */
export function SystemTransferScene({ w = 20, h = 18 }: PlaybackSceneProps) {
  const model = useMemo(
    () => ({ first: transferFirstScene(), frames: transferFrames() }),
    [],
  );
  return (
    <FramePlayer
      widgetId="system-view"
      name="transfer"
      setup={followAndZoom}
      first={model.first}
      frames={model.frames}
      w={w}
      h={h}
    />
  );
}

/** Map View over two orbits of Kerbin, the ground track marching west as the planet turns beneath it. */
export function MapOrbitScene({ w = 18, h = 12 }: PlaybackSceneProps) {
  const model = useMemo(
    () => ({ first: orbitFirstScene(), frames: orbitFrames() }),
    [],
  );
  return (
    <FramePlayer
      widgetId="map-view"
      name="orbit"
      first={model.first}
      frames={model.frames}
      w={w}
      h={h}
    />
  );
}

/** The Navball through a gravity turn: the pitch falling away from vertical, the throttle dipping through max-Q, SAS taking prograde. */
export function NavballAscentScene({ w = 8, h = 12 }: PlaybackSceneProps) {
  const model = useMemo(
    () => ({ first: ascentFirstScene(), frames: ascentFrames() }),
    [],
  );
  return (
    <FramePlayer
      widgetId="navball"
      name="ascent"
      first={model.first}
      frames={model.frames}
      w={w}
      h={h}
    />
  );
}
