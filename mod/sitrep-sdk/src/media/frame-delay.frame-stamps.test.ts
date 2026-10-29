/**
 * The delay pipeline dating frames from the camera's per-frame stamps. The game
 * runs at 0.89 of wall time, so a capture clock sampled once a second and carried
 * forward at warp 1 drifts ahead by about 110 ms each second and snaps back; the
 * stamps must keep frames in decode order with an even step between them
 * whatever that clock does.
 */

import { describe, expect, it } from "vitest";
import { type CaptureClockSample, interpolateCaptureUt } from "./capture-clock";
import {
  type FrameLike,
  type FrameSink,
  type FrameSource,
  runFrameDelayPipeline,
} from "./frame-delay";
import {
  bindFrameStamps,
  type FrameStamp,
  type FrameStampFeed,
} from "./frame-stamp-timeline";

interface TestFrame extends FrameLike {
  id: number;
  metadata(): { rtpTimestamp: number };
}

const GAME_RATE = 0.89;
const FPS = 25;
const RTP_PER_FRAME = 90000 / FPS;

interface Written {
  id: number;
  ut: number;
}

interface PlayOptions {
  seconds: number;
  /** Seconds of delay the viewer's edge runs behind the game */
  delaySeconds: number;
  dating: "clock" | "stamps";
  /** The stamp the camera sends for a frame, or `null` for one that is lost */
  stampFor(id: number, trueUt: number): FrameStamp | null;
  /** The game's UT at a wall time; may jump (a quickload) */
  gameUt(wall: number): number;
}

/** Plays frames through the pipeline at `FPS` and returns what it wrote, in order. */
async function play(opts: PlayOptions): Promise<Written[]> {
  let wall = 0;
  const frameListeners = new Set<(ut: number) => void>();
  const view = {
    confirmedEdgeUt: () => opts.gameUt(wall) - opts.delaySeconds,
    onFrame: (cb: (ut: number) => void) => {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },
  };

  const stampListeners = new Set<(s: FrameStamp) => void>();
  const feed: FrameStampFeed = {
    subscribe(l) {
      stampListeners.add(l);
      return () => stampListeners.delete(l);
    },
  };

  let sample: CaptureClockSample = { ut: null, warpRate: 1, atMs: 0 };
  const stampOf = new Map<number, number>();
  const written: Written[] = [];

  let wake = null as ((frame: TestFrame) => void) | null;
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
      written.push({ id: frame.id, ut: stampOf.get(frame.id) ?? Number.NaN });
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const stamps =
    opts.dating === "stamps"
      ? bindFrameStamps(feed, () => pipeline.flush())
      : null;
  const pipeline = runFrameDelayPipeline<TestFrame>({
    view,
    source,
    sink,
    captureUt: (frame) => {
      const ut = stamps
        ? stamps.captureUt(frame)
        : (interpolateCaptureUt(sample, wall * 1000) ??
          Number.POSITIVE_INFINITY);
      stampOf.set(frame.id, ut);
      return ut;
    },
  });

  const frames = Math.floor(opts.seconds * FPS);
  for (let id = 0; id < frames; id += 1) {
    wall = id / FPS;
    const trueUt = opts.gameUt(wall);
    if (id % FPS === 0) {
      sample = { ut: trueUt, warpRate: 1, atMs: wall * 1000 };
    }
    const stamp = opts.stampFor(id, trueUt);
    if (stamp) for (const l of stampListeners) l(stamp);
    wake?.({
      id,
      metadata: () => ({ rtpTimestamp: Math.round(id * RTP_PER_FRAME) }),
      close() {},
    });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    for (const l of frameListeners) l(opts.gameUt(wall));
  }
  return written;
}

const slowGame = (wall: number) => 1000 + GAME_RATE * wall;

const everyStamp = (id: number, trueUt: number): FrameStamp => ({
  rtpTimestamp: Math.round(id * RTP_PER_FRAME),
  ut: trueUt,
  epoch: 1,
});

function steps(written: Written[]): number[] {
  return written.slice(1).map((f, i) => f.ut - (written[i] as Written).ut);
}

describe("a game running slower than wall time", () => {
  const expectedStep = GAME_RATE / FPS;

  it("steps content evenly when frames are dated from their own stamps", async () => {
    const written = await play({
      seconds: 8,
      delaySeconds: 0.5,
      dating: "stamps",
      gameUt: slowGame,
      stampFor: everyStamp,
    });

    expect(written.map((f) => f.id)).toEqual(
      written.map((_, i) => (written[0] as Written).id + i),
    );
    for (const step of steps(written)) {
      expect(step).toBeCloseTo(expectedStep, 6);
    }
  });

  it("does not step evenly when frames are dated from the 1 Hz capture clock", async () => {
    const written = await play({
      seconds: 8,
      delaySeconds: 0.5,
      dating: "clock",
      gameUt: slowGame,
      stampFor: () => null,
    });

    const uneven = steps(written).filter(
      (step) => Math.abs(step - expectedStep) > 0.001,
    );
    expect(uneven.length).toBeGreaterThan(0);
  });

  it("dates a frame whose stamp was lost from the stamps around it", async () => {
    const written = await play({
      seconds: 8,
      delaySeconds: 0.5,
      dating: "stamps",
      gameUt: slowGame,
      stampFor: (id, ut) => (id % 7 === 3 ? null : everyStamp(id, ut)),
    });

    for (const step of steps(written)) {
      expect(step).toBeCloseTo(expectedStep, 6);
    }
  });
});

describe("a new capture epoch", () => {
  it("empties the frames held from the old one and plays the new from its own times", async () => {
    // Quickload at wall 4 s: the game goes from about 1003.6 back to 500
    const reloadAt = 4;
    const gameUt = (wall: number) =>
      wall < reloadAt
        ? 1000 + GAME_RATE * wall
        : 500 + GAME_RATE * (wall - reloadAt);
    const written = await play({
      seconds: 8,
      delaySeconds: 1,
      dating: "stamps",
      gameUt,
      stampFor: (id, ut) => ({
        rtpTimestamp: Math.round(id * RTP_PER_FRAME),
        ut,
        epoch: id / FPS < reloadAt ? 1 : 2,
      }),
    });

    const oldEpoch = written.filter((f) => f.ut > 900);
    const newEpoch = written.filter((f) => f.ut < 900);
    // Nothing from before the reload surfaces after the first new-epoch frame
    const firstNew = written.findIndex((f) => f.ut < 900);
    expect(written.slice(firstNew).every((f) => f.ut < 900)).toBe(true);
    expect(oldEpoch.length).toBeGreaterThan(0);
    expect(newEpoch.length).toBeGreaterThan(0);
    for (const step of steps(newEpoch)) {
      expect(step).toBeCloseTo(GAME_RATE / FPS, 6);
    }
  });
});

describe("a camera restarting inside one capture epoch", () => {
  it("releases the new source's frames instead of holding them against the old timeline", async () => {
    // Relaunch at wall 4 s: stamps keep the epoch but the game UT goes back
    const reloadAt = 4;
    const gameUt = (wall: number) =>
      wall < reloadAt
        ? 1000 + GAME_RATE * wall
        : 200 + GAME_RATE * (wall - reloadAt);
    const written = await play({
      seconds: 8,
      delaySeconds: 1,
      dating: "stamps",
      gameUt,
      stampFor: everyStamp,
    });

    const firstNew = written.findIndex((f) => f.ut < 900);
    expect(firstNew).toBeGreaterThan(-1);
    expect(written.slice(firstNew).every((f) => f.ut < 900)).toBe(true);
    expect(written.slice(firstNew).length).toBeGreaterThan(FPS);
  });
});
