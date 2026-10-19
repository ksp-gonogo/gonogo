import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DYNAMIC_WHOLE_TOPIC_PREFIXES,
  PRODUCTION_DERIVED_CHANNELS,
  ReplayTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { createFakeWallClock } from "@ksp-gonogo/sitrep-sdk/testing";
import type { JSX, ReactNode } from "react";

/** A recording of the wire from a real flight: `{ subscribedTopics, frames }`, each frame the raw text of one stream frame, as `ReplayTransport` takes it. */
export interface RigFixture {
  subscribedTopics?: readonly string[];
  frames: readonly string[];
}

/** The recordings checked in beside Landing Status, trimmed to the topics the widget mounts on. */
export type RigName = "landing-lowpass" | "landing-crashfall";

/**
 * The recordings predate the `subscribed` ack carrying the channel's keyframe interval, so the loader adds it to each vessel topic's ack, the only frames it touches. The vessel channels all declare 30 s of game time; every data frame is exactly as recorded.
 */
const VESSEL_KEYFRAME_INTERVAL_UT = 30;

function isRigFixture(value: unknown): value is RigFixture {
  return (
    typeof value === "object" &&
    value !== null &&
    "frames" in value &&
    Array.isArray(value.frames)
  );
}

/** Whether `frame` is the `subscribed` ack of a vessel topic, the only frame the loader adds the keyframe interval to. */
function isVesselAck(frame: unknown): frame is object {
  return (
    typeof frame === "object" &&
    frame !== null &&
    "type" in frame &&
    frame.type === "event" &&
    "name" in frame &&
    frame.name === "subscribed" &&
    "topic" in frame &&
    typeof frame.topic === "string" &&
    frame.topic.startsWith("vessel.")
  );
}

export function rigFixture(name: RigName): RigFixture {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../LandingStatus/__fixtures__/rig",
    `${name}.replay.json`,
  );
  const recorded: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRigFixture(recorded)) throw new Error(`${name}: not a recording`);
  return {
    ...recorded,
    frames: recorded.frames.map((raw) => {
      const frame: unknown = JSON.parse(raw);
      if (!isVesselAck(frame)) return raw;
      return JSON.stringify({
        ...frame,
        keyframeIntervalUt: VESSEL_KEYFRAME_INTERVAL_UT,
      });
    }),
  };
}

/**
 * A recording kept under `tests/fixtures/wire` (JSON Lines, one `{ t, f }` per frame, cut with `wire-fixture.mjs`), as the frames `ReplayTransport` takes: the stream and event frames, every one exactly as recorded.
 */
export function wireFixture(name: string): RigFixture {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../tests/fixtures/wire",
    `${name}.jsonl`,
  );
  const frames: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const row: unknown = JSON.parse(line);
    if (typeof row !== "object" || row === null || !("f" in row)) {
      throw new Error(`${name}: not a recording`);
    }
    frames.push(typeof row.f === "string" ? row.f : JSON.stringify(row.f));
  }
  return { frames };
}

export interface RigReplay {
  /** Wraps the widget in the pipeline the recording is played into. */
  Provider: (props: { children: ReactNode }) => JSX.Element;
  /** Seconds from the first frame to the last. */
  duration: number;
  /** Deliver every frame due by `seconds` from the start, move the wall clock to it and mint one frame. */
  advanceTo: (seconds: number) => void;
}

/**
 * A recorded flight played into a real `TelemetryClient` and `TimelineStore` through `ReplayTransport`, on a clock the test drives, so a widget can be stepped through a real landing second by second with nothing racing a timer. The view clock is left live, as in the app, so the staleness of each topic is judged the way it is there.
 */
export function startRigReplay(fixture: RigFixture): RigReplay {
  const pending: { atUt: number; fn: () => void }[] = [];
  const transport = new ReplayTransport(fixture, {
    clock: {
      now: () => 0,
      schedule: (atUt, fn) => {
        const entry = { atUt, fn };
        pending.push(entry);
        return () => {
          const i = pending.indexOf(entry);
          if (i !== -1) pending.splice(i, 1);
        };
      },
    },
  });
  const wall = createFakeWallClock();
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: DYNAMIC_WHOLE_TOPIC_PREFIXES,
  });
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    store.registerDerivedChannel(channel);
  }
  clock.suspendFrames();
  const client = new TelemetryClient(transport);
  let at = 0;

  return {
    Provider: ({ children }) => (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    ),
    duration: pending.reduce((m, e) => Math.max(m, e.atUt), 0),
    advanceTo: (seconds) => {
      while (pending.length > 0 && pending[0].atUt <= seconds) {
        pending.shift()?.fn();
      }
      wall.advanceBy(seconds - at);
      at = seconds;
      clock.emitFrame();
      store.beginFrame();
    },
  };
}
