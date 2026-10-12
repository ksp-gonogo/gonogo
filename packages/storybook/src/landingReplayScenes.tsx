import type { MissionMeta } from "@ksp-gonogo/sitrep-sdk";
import {
  getReplaySessionController,
  ReplaySessionProvider,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { useEffect, useMemo, useState } from "react";
import crashfall from "../../components/src/LandingStatus/__fixtures__/rig/landing-crashfall.replay.json";
import lowpass from "../../components/src/LandingStatus/__fixtures__/rig/landing-lowpass.replay.json";
import { RequiresGuard } from "../../components/src/shared/RequiresGuard";
import { DEFAULT_SIZE } from "../scripts/landingStorySize";
import { PlaybackStart } from "./PlaybackStart";
import { WidgetScene } from "./WidgetScene";

/** The stamp of a recorded frame, read without trusting its shape. */
function stampOf(raw: string): Record<string, unknown> {
  const frame: unknown = JSON.parse(raw);
  if (
    typeof frame === "object" &&
    frame !== null &&
    "meta" in frame &&
    typeof frame.meta === "object" &&
    frame.meta !== null
  ) {
    return { ...frame.meta };
  }
  return {};
}

/** The crash recording with the game leaving the flight scene for the space centre a few seconds after its last frame. */
function crashThenSpaceCentre() {
  const num = (stamp: Record<string, unknown>, key: string) => {
    const v = stamp[key];
    return typeof v === "number" ? v : 0;
  };
  const last = crashfall.frames
    .map(stampOf)
    .reduce((a, b) => (num(b, "deliveredAt") > num(a, "deliveredAt") ? b : a));
  const leaving = JSON.stringify({
    type: "stream-data",
    topic: "spaceCenter.scene",
    payload: { scene: "SpaceCenter", launchSite: null },
    meta: {
      ...last,
      seq: num(last, "seq") + 1,
      validAt: num(last, "validAt") + 6,
      deliveredAt: num(last, "deliveredAt") + 6,
    },
  });
  return { ...crashfall, frames: [...crashfall.frames, leaving] };
}

/** The real landings the live rig recorded off the wire, trimmed to what Landing Status mounts on. */
const RECORDINGS = {
  lowpass: {
    fixture: lowpass,
    label: "a low pass over the Mun",
    gated: false,
  },
  crashfall: {
    fixture: crashfall,
    label: "a fast crash on the Mun",
    gated: false,
  },
  crashleaves: {
    fixture: crashThenSpaceCentre(),
    label: "a fast crash, then the game leaves the flight scene",
    gated: true,
  },
} as const;

export type LandingRecording = keyof typeof RECORDINGS;

/** Recording seconds played per real second. */
const REPLAY_RATE = 6;
/** Real seconds the last scene is held on screen before the story ends. */
const HOLD_SECONDS = 4;

/** The delivery time a recorded frame carries, or null for one that has none. */
function deliveredAtOf(raw: string): number | null {
  const frame: unknown = JSON.parse(raw);
  if (typeof frame !== "object" || frame === null || !("meta" in frame)) {
    return null;
  }
  const { meta } = frame;
  return typeof meta === "object" &&
    meta !== null &&
    "deliveredAt" in meta &&
    typeof meta.deliveredAt === "number"
    ? meta.deliveredAt
    : null;
}

function spanOf(frames: readonly string[]): [number, number] {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const raw of frames) {
    const at = deliveredAtOf(raw);
    if (at === null) continue;
    first = Math.min(first, at);
    last = Math.max(last, at);
  }
  return [first, last];
}

/** Starts the replay session when it mounts and ends it when it unmounts, so a keyed instance is one pass through the recording. */
function ReplayPass({
  recording,
  first,
  last,
  onPlayed,
}: {
  recording: LandingRecording;
  first: number;
  last: number;
  onPlayed: (seconds: number) => void;
}) {
  const { fixture } = RECORDINGS[recording];
  useEffect(() => {
    const controller = getReplaySessionController();
    const meta: MissionMeta = {
      id: `landing-${recording}`,
      vesselName: "Muna 1",
      launchedAt: 0,
      firstFrameUt: first,
      lastFrameUt: last,
      frameCount: fixture.frames.length,
    };
    controller.start(meta, fixture);
    controller.setRate(REPLAY_RATE);
    const t0 = performance.now();
    const timer = setInterval(() => {
      const played = ((performance.now() - t0) / 1000) * REPLAY_RATE;
      onPlayed(Math.min(last - first, Math.floor(played)));
      if (played >= last - first) clearInterval(timer);
    }, 250);
    return () => {
      clearInterval(timer);
      controller.stop();
    };
  }, [fixture, recording, first, last, onPlayed]);
  return null;
}

export interface LandingReplaySceneProps {
  recording: LandingRecording;
  w?: number;
  h?: number;
}

/**
 * Landing Status played through a landing the live rig recorded off the wire, by the app's own mission-replay path: the frames reach the widget through `ReplayTransport` and the replay session's client and store, the same ones a replayed mission uses, so the widget reads each topic's currency as it does in the app. Replay starts it over.
 */
export function LandingReplayScene({
  recording,
  w = DEFAULT_SIZE.w,
  h = DEFAULT_SIZE.h,
}: LandingReplaySceneProps) {
  const { fixture, label, gated } = RECORDINGS[recording];
  const [first, last] = useMemo(() => spanOf(fixture.frames), [fixture]);
  const seconds = last - first;
  const [run, setRun] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  return (
    <div data-story-seconds={Math.ceil(seconds / REPLAY_RATE + HOLD_SECONDS)}>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <PlaybackStart onClick={() => setRun((n) => n + 1)}>
          Replay
        </PlaybackStart>
        <span aria-live="off">
          {label}: T+{elapsed} of T+{Math.floor(seconds)}, played at{" "}
          {REPLAY_RATE} times speed
        </span>
      </div>
      <ReplayPass
        key={run}
        recording={recording}
        first={first}
        last={last}
        onPlayed={setElapsed}
      />
      <WidgetScene
        key={`scene-${run}`}
        widgetId="landing-status"
        fixture={{
          _meta: { scenario: label, synthetic: false },
          _stream: { pinnedUt: 10, emits: [] },
        }}
        w={w}
        h={h}
        wrap={(tree) => (
          <ReplaySessionProvider>
            {gated ? (
              <RequiresGuard
                requires={["flight"]}
                heldOpenBy={["crash-ending"]}
                title="LANDING"
              >
                {tree}
              </RequiresGuard>
            ) : (
              tree
            )}
          </ReplaySessionProvider>
        )}
      />
    </div>
  );
}
