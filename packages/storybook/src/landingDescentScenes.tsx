import { Button } from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Frame,
  integrate,
  streamFixture,
} from "../../components/scripts/landingDescentModel";
import type { ProbeMount } from "../../components/scripts/probe/probe-entry";
import { WidgetScene } from "./WidgetScene";

/** Descent seconds played per real second. */
const PLAYBACK_RATE = 6;
const ONE_WAY_SECONDS = 4;

export interface LandingDescentSceneProps {
  /** Comes in too fast and meets the ground, instead of burning down to a soft touchdown. */
  crash?: boolean;
  w?: number;
  h?: number;
}

interface Emit {
  channel: string;
  value: unknown;
  meta?: Record<string, unknown>;
}

function emitsOf(frame: Frame): Emit[] {
  const stream = streamFixture(frame, ONE_WAY_SECONDS, "descent", "") as {
    _stream: { emits: Emit[] };
  };
  return stream._stream.emits;
}

/**
 * Landing Status mounted on the first frame of a synthetic Mun descent, then
 * fed every later frame in turn at a fixed playback rate, so the altitude rail
 * and the rest of the widget can be watched reacting. Replay starts it over.
 */
export function LandingDescentScene({
  crash = false,
  w = 12,
  h = 16,
}: LandingDescentSceneProps) {
  const frames = useMemo(() => integrate({ crash }), [crash]);
  const first = useMemo(() => {
    const fixture = streamFixture(
      frames[0],
      ONE_WAY_SECONDS,
      "descent",
      crash
        ? "Comes in too fast and meets the ground."
        : "Burns down to a soft touchdown.",
    );
    return fixture;
  }, [frames, crash]);
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
          return;
        }
        for (const e of emitsOf(frame)) mount.emit(e.channel, e.value, e.meta);
        setElapsed(frame.t);
      }, 1000 / PLAYBACK_RATE);
    },
    [frames],
  );

  const replay = () => {
    clearInterval(timer.current);
    setElapsed(0);
    setRun((n) => n + 1);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <Button size="sm" onClick={replay}>
          Replay
        </Button>
        <span aria-live="off">
          Descent clock T+{elapsed} of T+{frames[frames.length - 1].t}, played
          at {PLAYBACK_RATE} times speed
        </span>
      </div>
      <WidgetScene
        key={`${crash}-${run}`}
        widgetId="landing-status"
        fixture={first}
        w={w}
        h={h}
        onMounted={play}
      />
    </div>
  );
}
