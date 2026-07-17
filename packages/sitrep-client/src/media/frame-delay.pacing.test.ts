/**
 * `runFrameDelayPipeline`'s optional `pacing` wiring (cross-browser
 * video-delay design, 2026-07-16). `PresentationPacer` itself is
 * unit-tested in isolation (`worker/presentationPacer.test.ts`) — this file
 * only proves `runFrameDelayPipeline` wires it correctly: releases route
 * through the pacer instead of writing immediately, `tickPacing()` drains
 * it, and `dispose()` tears the pacer down too. Kept separate from
 * `frameDelay.test.ts`/`frame-delay.block-colour.test.ts` so those files stay
 * byte-for-byte proof of the un-paced (default) behaviour.
 */

import { describe, expect, it, vi } from "vitest";
import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  type FrameSink,
  type FrameSource,
  runFrameDelayPipeline,
} from "./frame-delay";

function manualClock(initialEdge = Number.NEGATIVE_INFINITY): DelayClockLike & {
  setEdge(v: number): void;
} {
  let edge = initialEdge;
  const listeners = new Set<(viewUt: number) => void>();
  return {
    confirmedEdgeUt: () => edge,
    onFrame: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setEdge(v: number) {
      edge = v;
      listeners.forEach((cb) => {
        cb(v);
      });
    },
  };
}

function colourFrame(colour: string) {
  return {
    colour,
    closeCount: 0,
    close() {
      this.closeCount += 1;
    },
  };
}
type ColourFrame = ReturnType<typeof colourFrame>;

function queuedSource(frames: ColourFrame[]): FrameSource<ColourFrame> {
  let i = 0;
  return {
    read: () => {
      if (i >= frames.length) return new Promise(() => {});
      const value = frames[i] as ColourFrame;
      i += 1;
      return Promise.resolve({ done: false, value });
    },
    cancel: () => Promise.resolve(),
  };
}

function recordingSink(): FrameSink<ColourFrame> & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write(frame) {
      written.push(frame.colour);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
}

describe("runFrameDelayPipeline — pacing wiring", () => {
  it("without `pacing`, a burst release still writes everything synchronously (unchanged default)", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frames = [
      colourFrame("red"),
      colourFrame("green"),
      colourFrame("blue"),
    ];
    const uts = [100, 100.033, 100.066];
    let i = 0;
    const sink = recordingSink();

    runFrameDelayPipeline({
      view: clock,
      captureUt: () => uts[i++] ?? 100.066,
      source: queuedSource(frames),
      sink,
      maxBufferedFrames: 10,
    });

    await vi.waitFor(() => expect(i).toBe(3));
    clock.setEdge(200); // releases all three at once — no pacer to space them
    expect(sink.written).toEqual(["red", "green", "blue"]);
  });

  it("with `pacing`, a burst release is held and drained by tickPacing spaced by UT delta", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frames = [
      colourFrame("red"),
      colourFrame("green"),
      colourFrame("blue"),
    ];
    const uts = [100, 100.033, 100.066];
    let i = 0;
    const sink = recordingSink();

    const pipeline = runFrameDelayPipeline({
      view: clock,
      captureUt: () => uts[i++] ?? 100.066,
      source: queuedSource(frames),
      sink,
      maxBufferedFrames: 10,
      pacing: { maxBacklogSeconds: 1 },
    });

    await vi.waitFor(() => expect(i).toBe(3));
    clock.setEdge(200); // buffer releases all three into the pacer at once...

    // ...but nothing has been WRITTEN yet — tickPacing hasn't drained it.
    expect(sink.written).toEqual([]);

    pipeline.tickPacing(0);
    expect(sink.written).toEqual(["red"]);

    pipeline.tickPacing(0.02);
    expect(sink.written).toEqual(["red"]); // green not due yet

    pipeline.tickPacing(0.04);
    expect(sink.written).toEqual(["red", "green"]);

    pipeline.tickPacing(0.07);
    expect(sink.written).toEqual(["red", "green", "blue"]);

    // Every paced-and-written frame still gets closed exactly once.
    await vi.waitFor(() => {
      expect(frames.every((f) => f.closeCount === 1)).toBe(true);
    });
  });

  it("dispose() tears the pacer down too — anything still queued in it is closed, never written", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frames = [colourFrame("red"), colourFrame("green")];
    const uts = [100, 100.5];
    let i = 0;
    const sink = recordingSink();

    const pipeline = runFrameDelayPipeline({
      view: clock,
      captureUt: () => uts[i++] ?? 100.5,
      source: queuedSource(frames),
      sink,
      maxBufferedFrames: 10,
      pacing: { maxBacklogSeconds: 1 },
    });

    await vi.waitFor(() => expect(i).toBe(2));
    clock.setEdge(200);
    pipeline.tickPacing(0); // presents "red" only; "green" is still queued in the pacer

    expect(sink.written).toEqual(["red"]);
    expect(frames[1]?.closeCount).toBe(0);

    pipeline.dispose();

    expect(sink.written).toEqual(["red"]); // "green" never written
    expect(frames[1]?.closeCount).toBe(1); // but it IS closed (no leak)
  });
});
