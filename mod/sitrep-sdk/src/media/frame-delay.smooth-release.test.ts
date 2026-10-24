/**
 * The paced pipeline fed the way a live save feeds it: video frames stamped
 * from a capture clock that is sampled about once a second, released by an edge
 * that is limited to the newest telemetry sample. A game that runs slower than
 * wall time, or telemetry that arrives once a second, makes every release a
 * burst of about a second of video, and the picture must still move steadily.
 */

import { describe, expect, it } from "vitest";
import { computeConfirmedEdgeUt } from "../view-clock-formula";
import { type CaptureClockSample, interpolateCaptureUt } from "./capture-clock";
import {
  type FrameLike,
  type FrameSink,
  type FrameSource,
  runFrameDelayPipeline,
} from "./frame-delay";

interface TestFrame extends FrameLike {
  id: number;
}

interface Scenario {
  /** Game seconds per wall second */
  utRate: number;
  telemetryHz: number;
  framesPerSecond: number;
}

const ONE_WAY_LATENCY = 0.03;
const SECONDS = 60;
const SETTLE_SECONDS = 15;
const TICK_SECONDS = 1 / 60;

/**
 * Runs the pipeline on a virtual clock and returns the wall time each frame was
 * written at, with the check that none was written before its edge allowed.
 */
async function play(scenario: Scenario) {
  const gameUt = (wall: number) => 1000 + scenario.utRate * wall;
  let now = 0;

  const clock = {
    anchorWall: undefined as number | undefined,
    anchorUt: undefined as number | undefined,
    maxSampleUt: Number.NEGATIVE_INFINITY,
    delaySeconds: 0,
    warpRate: 1,
    slackSeconds: 0,
  };
  const view = {
    confirmedEdgeUt: () => computeConfirmedEdgeUt(clock, now),
    onFrame: () => () => {},
  };

  let sample: CaptureClockSample = { ut: null, warpRate: 1, atMs: 0 };
  const stamps: number[] = [];
  const written: { id: number; wall: number }[] = [];
  const early: number[] = [];

  let wake: ((frame: TestFrame) => void) | null = null;
  const source: FrameSource<TestFrame> = {
    read: () =>
      new Promise((resolve) => {
        wake = (value) => resolve({ done: false, value });
      }),
    cancel: () => Promise.resolve(),
  };
  const sink: FrameSink<TestFrame> = {
    write: (frame) => {
      if (!frame) throw new Error("the pipeline wrote no frame");
      written.push({ id: frame.id, wall: now });
      const stamp = stamps[frame.id] as number;
      if (view.confirmedEdgeUt() < stamp) early.push(frame.id);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const pipeline = runFrameDelayPipeline<TestFrame>({
    view,
    source,
    sink,
    captureUt: () => {
      const stamp = interpolateCaptureUt(sample, now * 1000) ?? Infinity;
      stamps.push(stamp);
      return stamp;
    },
    pacing: { maxBacklogSeconds: 0.5, maxLeadSeconds: 2 },
  });

  const events: { at: number; run: () => Promise<void> | void }[] = [];
  for (
    let n = 0, t = 0.1;
    t < SECONDS + 1;
    n += 1, t = 0.1 + n / scenario.framesPerSecond
  ) {
    const id = n;
    events.push({
      at: t + ONE_WAY_LATENCY,
      run: async () => {
        wake?.({ id, close() {} });
        for (let i = 0; i < 4; i += 1) await Promise.resolve();
      },
    });
  }
  for (let t = 0.1; t < SECONDS + 1; t += 1 / scenario.telemetryHz) {
    events.push({
      at: t + ONE_WAY_LATENCY,
      run: () => {
        const ut = gameUt(t);
        clock.maxSampleUt = Math.max(clock.maxSampleUt, ut);
        clock.anchorWall = now;
        clock.anchorUt = ut;
      },
    });
  }
  for (let t = 0.1; t < SECONDS + 1; t += 1) {
    events.push({
      at: t + ONE_WAY_LATENCY,
      run: () => {
        sample = { ut: gameUt(t), warpRate: 1, atMs: now * 1000 };
      },
    });
  }
  events.sort((a, b) => a.at - b.at);

  let next = 0;
  let nextTick = 0;
  for (now = 0; now < SECONDS; now += 0.001) {
    while (events[next] && (events[next] as { at: number }).at <= now) {
      await (events[next] as { run: () => Promise<void> | void }).run();
      next += 1;
    }
    if (now >= nextTick) {
      pipeline.tickPacing(now);
      nextTick += TICK_SECONDS;
    }
  }
  pipeline.dispose();

  const settled = written.filter((w) => w.wall >= SETTLE_SECONDS);
  const gaps = settled
    .slice(1)
    .map((w, i) => w.wall - (settled[i] as { wall: number }).wall);
  return {
    longestGap: Math.max(...gaps),
    early,
    written: written.length,
    stats: pipeline.stats(),
  };
}

const STALL_SECONDS = 0.25;

describe("paced delayed video with sample-limited releases", () => {
  it.each([
    {
      name: "1 Hz telemetry, game at 0.95 of wall time",
      utRate: 0.95,
      telemetryHz: 1,
    },
    { name: "1 Hz telemetry, game at wall time", utRate: 1, telemetryHz: 1 },
    {
      name: "10 Hz telemetry, game at 0.95 of wall time",
      utRate: 0.95,
      telemetryHz: 10,
    },
    { name: "10 Hz telemetry, game at wall time", utRate: 1, telemetryHz: 10 },
  ])("$name never stalls the picture for a quarter of a second", async ({
    utRate,
    telemetryHz,
  }) => {
    const result = await play({ utRate, telemetryHz, framesPerSecond: 23 });
    expect(result.longestGap).toBeLessThan(STALL_SECONDS);
  });

  it("never writes a frame before the edge reaches its capture time", async () => {
    const result = await play({
      utRate: 0.95,
      telemetryHz: 1,
      framesPerSecond: 23,
    });
    expect(result.early).toEqual([]);
  });
});
