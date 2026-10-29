import { describe, expect, it } from "vitest";
import { computeConfirmedEdgeUt } from "../view-clock-formula";
import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  DEFAULT_PACING_MAX_LEAD_SECONDS,
  type FrameSink,
  type FrameSource,
  runFrameDelayPipeline,
} from "./frame-delay";

interface Frame {
  id: number;
  close(): void;
}

interface Scenario {
  delaySeconds: number;
  telemetryPeriod: number;
  fps: number;
  seconds: number;
  gameRate?: number;
  stampOffset?: number;
  sampleJitter?: number;
}

/*
 * A wall clock stepped at 60 Hz, a game clock at 1:1, telemetry samples every
 * `telemetryPeriod` and camera frames every `1 / fps`, each stamped with the
 * live game UT as the capture clock would stamp it. The view clock is the real
 * formula, so the edge is clamped to the latest sample exactly as the app's.
 */
async function simulate(s: Scenario) {
  let wall = 0;
  let maxSampleUt = Number.NEGATIVE_INFINITY;
  let anchor: { wall: number; ut: number } | undefined;
  const ut0 = 1000;
  const gameUt = () => ut0 + wall * (s.gameRate ?? 1);
  let rand = 1;
  const jitter = () => {
    rand = (rand * 16807) % 2147483647;
    return (rand / 2147483647) * (s.sampleJitter ?? 0);
  };
  const frameListeners = new Set<(viewUt: number) => void>();
  const view: DelayClockLike = {
    confirmedEdgeUt: () =>
      computeConfirmedEdgeUt(
        {
          anchorWall: anchor?.wall,
          anchorUt: anchor?.ut,
          maxSampleUt,
          delaySeconds: s.delaySeconds,
          warpRate: 1,
          slackSeconds: 0,
        },
        wall,
      ),
    onFrame: (cb) => {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },
  };

  const reader: { pending: ((f: Frame) => void) | null } = { pending: null };
  const source: FrameSource<Frame> = {
    read: () =>
      new Promise((resolve) => {
        reader.pending = (value) => resolve({ done: false, value });
      }),
    cancel: () => Promise.resolve(),
  };
  const presentedAt: number[] = [];
  const sink: FrameSink<Frame> = {
    write: () => {
      presentedAt.push(wall);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const pipeline = runFrameDelayPipeline<Frame>({
    view,
    captureUt: () => gameUt() + (s.stampOffset ?? 0),
    source,
    sink,
    pacing: {
      maxBacklogSeconds: 0.5,
      maxLeadSeconds: DEFAULT_PACING_MAX_LEAD_SECONDS,
    },
  });

  const tick = 1 / 60;
  let nextFrame = 0;
  let nextSample = 0;
  let id = 0;
  for (let step = 0; step * tick < s.seconds; step++) {
    wall = step * tick;
    if (wall >= nextSample) {
      maxSampleUt = gameUt();
      anchor = { wall, ut: gameUt() };
      nextSample += s.telemetryPeriod + jitter();
    }
    if (wall >= nextFrame) {
      nextFrame += 1 / s.fps;
      await Promise.resolve();
      reader.pending?.({ id: id++, close() {} });
      await Promise.resolve();
      await Promise.resolve();
    }
    for (const cb of frameListeners) cb(wall);
    pipeline.tickPacing(wall);
  }
  const stats = pipeline.stats();
  pipeline.dispose();

  const settled = presentedAt.filter((t) => t >= 2);
  const span = s.seconds - 2;
  let largestGap = 0;
  for (let i = 1; i < settled.length; i++) {
    largestGap = Math.max(
      largestGap,
      (settled[i] ?? 0) - (settled[i - 1] ?? 0),
    );
  }
  return { fps: settled.length / span, largestGap, stats };
}

describe("delayed video under a telemetry clock that confirms about once a second", () => {
  it.each([
    { name: "the game and the wall clock in step", extra: {} },
    {
      name: "the game running slower than the wall",
      extra: { gameRate: 0.96 },
    },
    { name: "frames stamped ahead of telemetry", extra: { stampOffset: 0.5 } },
    { name: "frames stamped behind telemetry", extra: { stampOffset: -0.3 } },
    { name: "samples arriving unevenly", extra: { sampleJitter: 0.3 } },
  ])("presents the camera's frame rate with $name", async ({ extra }) => {
    const r = await simulate({
      delaySeconds: 0,
      telemetryPeriod: 1.07,
      fps: 20,
      seconds: 12,
      ...extra,
    });
    expect(r.stats.pacerSkipped).toBe(0);
    expect(r.fps).toBeGreaterThan(19);
    expect(r.largestGap).toBeLessThan(0.3);
  });
});

describe("delayed video when the telemetry clock confirms less often than the pacer's lead limit", () => {
  it("keeps the whole cushion instead of catching up and leaving the decoder dry", async () => {
    const r = await simulate({
      delaySeconds: 0.001,
      telemetryPeriod: 2.2,
      fps: 30,
      seconds: 20,
    });

    expect(r.stats.pacerSkipped).toBe(0);
    expect(r.stats.pacerCatchUps).toBe(0);
    expect(r.largestGap).toBeLessThan(0.5);
  });
});
