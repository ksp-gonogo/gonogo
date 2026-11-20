import { getDataSource } from "@ksp-gonogo/core";
import {
  type ModeSourceOutput,
  registerModeSource,
} from "@ksp-gonogo/sitrep-sdk";
import type { MissionHistorySource } from "../FlightsManager/MissionHistorySource";

/** The mode a recorded flight is played back in. The mod declares it; the source here answers it. */
export const REPLAY_MODE = "replay";

/** The mode input that names the recording to play, by the flight's id. */
export const REPLAY_FLIGHT_INPUT = "flight";

/** The mode input that carries the recorded craft's name, for a screen to title the mode's pane by. */
export const REPLAY_TITLE_INPUT = "title";

/** The speeds a recording plays at. */
const REPLAY_RATES = [0.5, 1, 2, 5, 10, 50] as const;

interface Recorded {
  /** Set on a frame the recorder wrote at the start from what the stream already held: it is from before the recording began. */
  carried?: boolean;
  type?: string;
  topic?: string;
  payload?: { launchUt?: unknown } | null;
  meta?: { validAt?: unknown };
}

const nothing = (noTimeline: string): ModeSourceOutput => ({
  startUt: 0,
  endUt: 0,
  samples: [],
  noTimeline,
});

/**
 * A recording as what the mode shows: every frame as it was recorded, over a
 * timeline from the first moment any sample in it is true at to the last. The
 * moments are the craft's own, not when each frame arrived, so across a signal
 * delay the Timeline reads as the flight's time. T+0 is the launch the
 * recording's craft states, where that is at or before the recording begins.
 */
export function replayOutput(frames: readonly string[]): ModeSourceOutput {
  let startUt = Number.POSITIVE_INFINITY;
  let endUt = Number.NEGATIVE_INFINITY;
  let launchUt: number | undefined;
  for (const raw of frames) {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) continue;
    const message: Recorded = parsed;
    if (message.type !== "stream-data" && message.type !== "event") continue;
    const validAt = Number(message.meta?.validAt);
    if (!Number.isFinite(validAt)) continue;
    // The state the recording began from is shown from its first moment, and does not move that moment earlier.
    if (message.carried !== true) {
      startUt = Math.min(startUt, validAt);
      endUt = Math.max(endUt, validAt);
    }
    if (message.topic === "vessel.identity") {
      const stated = Number(message.payload?.launchUt);
      if (Number.isFinite(stated) && stated > 0) launchUt = stated;
    }
  }
  if (!(endUt > startUt)) {
    return nothing("Nothing recorded");
  }
  return {
    startUt,
    endUt,
    samples: [],
    frames,
    rates: REPLAY_RATES,
    // A launch stated partway through, as when the recording changes craft, would leave everything before it reading T+0: the times then count from the recording's own start.
    ...(launchUt === undefined || launchUt > startUt ? {} : { launchUt }),
  };
}

function recordings(): MissionHistorySource | undefined {
  return getDataSource("missionHistory") as MissionHistorySource | undefined;
}

/*
 * Runs on the hosting screen, which is the one that keeps the recordings. It
 * reads the chosen flight from where they are kept and publishes it whole;
 * every other screen is sent what it publishes.
 */
registerModeSource(REPLAY_MODE, {
  start: ({ inputs, publish }) => {
    const flight = inputs[REPLAY_FLIGHT_INPUT];
    const source = recordings();
    let stopped = false;
    if (!flight) {
      publish(nothing("No recording chosen"));
      return () => {};
    }
    if (!source) {
      publish(nothing("No recordings on this screen"));
      return () => {};
    }
    void source
      .exportFlight(flight)
      .then((fixture) => {
        if (stopped) return;
        // A flight that is not kept comes back as a recording with nothing in it.
        publish(
          fixture.frames.length === 0
            ? nothing("Recording not found")
            : replayOutput(fixture.frames),
        );
      })
      .catch(() => {
        if (!stopped) {
          publish(nothing("Recording not found"));
        }
      });
    return () => {
      stopped = true;
    };
  },
});
