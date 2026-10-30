import { describe, expect, it } from "vitest";
import { SampleStepTracker } from "../sample-step-tracker";
import { computeConfirmedEdgeUt } from "../view-clock-formula";
import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  DEFAULT_PACING_MAX_LEAD_SECONDS,
  type FrameSink,
  type FrameSource,
  runFrameDelayPipeline,
} from "./frame-delay";

interface Frame {
  ut: number;
  close(): void;
}

interface Presented {
  wall: number;
  ut: number;
  maxSampleUt: number;
}

/*
 * Telemetry confirms every `period(wall)` seconds from wall 0 and the camera
 * pipeline is built `attachAt` seconds in, part-way through an interval, as a
 * transform the browser attaches on its own schedule is. The delay is 1 ms, so
 * the edge is the latest sample. The clock reports its own measured step, as the
 * app's clocks do, and the pacer holds its first run by it when `hold` is set.
 */
async function attachMidInterval(
  attachAt: number,
  period: (wall: number) => number,
  hold: boolean,
) {
  let wall = 0;
  let maxSampleUt = Number.NEGATIVE_INFINITY;
  let anchor: { wall: number; ut: number } | undefined;
  const steps = new SampleStepTracker();
  const ut0 = 1000;
  const gameUt = () => ut0 + wall;
  const view: DelayClockLike = {
    confirmedEdgeUt: () =>
      computeConfirmedEdgeUt(
        {
          anchorWall: anchor?.wall,
          anchorUt: anchor?.ut,
          maxSampleUt,
          delaySeconds: 0.001,
          warpRate: 1,
          slackSeconds: 0,
        },
        wall,
      ),
    onFrame: () => () => {},
    sampleStepSeconds: () => steps.stepSeconds(),
  };

  const reader: { pending: ((f: Frame) => void) | null } = { pending: null };
  const source: FrameSource<Frame> = {
    read: () =>
      new Promise((resolve) => {
        reader.pending = (value) => resolve({ done: false, value });
      }),
    cancel: () => Promise.resolve(),
  };
  const presented: Presented[] = [];
  const sink: FrameSink<Frame> = {
    write: (f: Frame) => {
      presented.push({ wall, ut: f.ut, maxSampleUt });
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const tick = 1 / 60;
  let pipeline: ReturnType<typeof runFrameDelayPipeline<Frame>> | undefined;
  let nextFrame = attachAt;
  let nextSample = 0;
  for (let step = 0; step * tick < 8; step++) {
    wall = step * tick;
    if (wall >= nextSample) {
      maxSampleUt = gameUt();
      anchor = { wall, ut: gameUt() };
      steps.observe(maxSampleUt, wall);
      nextSample += period(wall);
    }
    if (!pipeline && wall >= attachAt) {
      pipeline = runFrameDelayPipeline<Frame>({
        view,
        captureUt: (f) => f.ut,
        source,
        sink,
        pacing: {
          maxBacklogSeconds: 0.5,
          maxLeadSeconds: DEFAULT_PACING_MAX_LEAD_SECONDS,
          expectedReleaseGapSeconds: hold
            ? () => view.sampleStepSeconds?.()
            : undefined,
        },
      });
    }
    if (pipeline && wall >= nextFrame) {
      nextFrame += 1 / 30;
      await Promise.resolve();
      reader.pending?.({ ut: gameUt(), close() {} });
      await Promise.resolve();
      await Promise.resolve();
    }
    pipeline?.tickPacing(wall);
  }
  pipeline?.dispose();
  return presented;
}

function largestGap(presented: Presented[]): number {
  let gap = 0;
  for (let i = 1; i < presented.length; i++) {
    gap = Math.max(
      gap,
      (presented[i]?.wall ?? 0) - (presented[i - 1]?.wall ?? 0),
    );
  }
  return gap;
}

const everySecond = () => 1;
const tenAtSecond = () => 0.1;
const secondThenTenth = (wall: number) => (wall < 3 ? 1 : 0.1);

function firstWall(presented: Presented[]): number {
  return presented[0]?.wall ?? Number.POSITIVE_INFINITY;
}

describe("a delayed feed attached part-way through a telemetry interval", () => {
  it("shows its first frames and then waits most of a second for the next sample when nothing is held", async () => {
    const presented = await attachMidInterval(1.7, everySecond, false);

    expect(largestGap(presented)).toBeGreaterThan(0.6);
  });

  it("keeps presenting without a pause once its first release is held to end at the next one", async () => {
    const presented = await attachMidInterval(1.7, everySecond, true);

    expect(largestGap(presented)).toBeLessThan(0.1);
  });

  it("starts as early as it would unheld when the clock steps ten times a second", async () => {
    const held = await attachMidInterval(3.33, tenAtSecond, true);
    const unheld = await attachMidInterval(3.33, tenAtSecond, false);

    expect(firstWall(held) - firstWall(unheld)).toBeLessThan(0.15);
    expect(largestGap(held)).toBeLessThan(0.15);
  });

  it("follows a clock that speeds up from a step a second to ten a second", async () => {
    const held = await attachMidInterval(6.03, secondThenTenth, true);
    const unheld = await attachMidInterval(6.03, secondThenTenth, false);

    expect(firstWall(held) - firstWall(unheld)).toBeLessThan(0.15);
  });

  it("never presents a frame dated after the latest telemetry sample, held or not", async () => {
    for (const period of [everySecond, tenAtSecond, secondThenTenth]) {
      for (const hold of [false, true]) {
        const presented = await attachMidInterval(1.7, period, hold);

        expect(presented.length).toBeGreaterThan(60);
        for (const p of presented)
          expect(p.ut).toBeLessThanOrEqual(p.maxSampleUt);
      }
    }
  });
});
