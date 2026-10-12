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

export function rigFixture(name: RigName): RigFixture {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../LandingStatus/__fixtures__/rig",
    `${name}.replay.json`,
  );
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("frames" in parsed) ||
    !Array.isArray(parsed.frames) ||
    !parsed.frames.every((f): f is string => typeof f === "string")
  ) {
    throw new Error(`${name} is not a recorded fixture`);
  }
  return { frames: parsed.frames };
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
