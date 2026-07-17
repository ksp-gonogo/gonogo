/**
 * Real per-frame video-delay proof (per-frame video delay,
 * 2026-07-15). Mirrors `DelayedPlayoutBuffer.blockColour.test.ts`'s
 * distinguishable-colour technique, but through `runFrameDelayPipeline` —
 * i.e. this drives MULTIPLE frames arriving off a SINGLE, continuously-open
 * source (one conceptual camera connection), which is exactly the gap the
 * old design had: `useDelayedPlayout` used to push ONE keyframe per raw
 * `MediaStream` *reference*, stamped once, and never re-examined ongoing
 * frames inside that same connection — so a red→green→blue sequence
 * arriving on one open stream would have shown "blue" (the live tail)
 * immediately, with no per-frame gating at all; only a brand-new stream
 * *reference* (a camera switch/reconnect) was ever delayed. This test
 * proves each frame is individually gated on the shared clock, in order,
 * never early — the property the old code could not have (there was no
 * mechanism to stamp/gate frame N+1 within an already-open stream).
 *
 * Each "frame" is a solid, readable colour token (`"red"`/`"green"`/
 * `"blue"`) with a `.close()` spy standing in for a WebCodecs `VideoFrame`.
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

/** Feeds a fixed queue of frames to the pump loop, one per `read()`, then
 *  hangs (an open, still-live source) until `cancel()`. */
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

describe("runFrameDelayPipeline — block-colour per-frame delay proof", () => {
  const T0 = 100; // red captured
  const T1 = 101; // green captured
  const T2 = 102; // blue captured

  it("with delay D > 0, each frame's colour surfaces exactly D seconds after ITS OWN capture UT, never before — all three arrive on one open source", async () => {
    const D = 5;
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frames = [
      colourFrame("red"),
      colourFrame("green"),
      colourFrame("blue"),
    ];
    const captureUts = [T0, T1, T2];
    let nextIdx = 0;
    const sink = recordingSink();

    runFrameDelayPipeline({
      view: clock,
      // Each call to captureUt() stamps the NEXT frame the pump loop reads
      // — the real per-frame behaviour (contrast the old design's single
      // stamp-per-stream-reference).
      captureUt: () => captureUts[nextIdx++] ?? captureUts.at(-1) ?? 0,
      source: queuedSource(frames),
      sink,
      maxBufferedFrames: 10,
    });

    // Let the pump loop read + stamp + queue all three frames before the
    // clock ever advances — mirrors frames arriving well ahead of the
    // delayed edge, same as the real WebRTC case. Wait on the capture-UT
    // call count (not just "nothing written yet", which would trivially
    // hold even mid-drain) so the rest of this test runs against a fully
    // queued buffer.
    await vi.waitFor(() => {
      expect(nextIdx).toBe(3);
    });
    expect(sink.written).toEqual([]); // nothing due yet — edge is -Infinity

    const edgeFor = (t: number) => t - D;

    clock.setEdge(edgeFor(T0 + D - 1));
    expect(sink.written).toEqual([]); // just before red's due instant

    clock.setEdge(edgeFor(T0 + D));
    expect(sink.written).toEqual(["red"]); // exactly on time

    clock.setEdge(edgeFor(T1 + D - 1));
    expect(sink.written).toEqual(["red"]); // still — green isn't due yet

    clock.setEdge(edgeFor(T1 + D));
    expect(sink.written).toEqual(["red", "green"]);

    clock.setEdge(edgeFor(T2 + D - 1));
    expect(sink.written).toEqual(["red", "green"]); // still — blue isn't due yet

    clock.setEdge(edgeFor(T2 + D));
    expect(sink.written).toEqual(["red", "green", "blue"]);

    // Every written frame gets closed after the write settles.
    await vi.waitFor(() => {
      expect(frames.every((f) => f.closeCount === 1)).toBe(true);
    });
  });

  it("control: with delay = 0, the same three-frame sequence flips the instant each frame is captured — no lag", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frames = [
      colourFrame("red"),
      colourFrame("green"),
      colourFrame("blue"),
    ];
    const captureUts = [T0, T1, T2];
    let nextIdx = 0;
    const sink = recordingSink();

    runFrameDelayPipeline({
      view: clock,
      captureUt: () => captureUts[nextIdx++] ?? captureUts.at(-1) ?? 0,
      source: queuedSource(frames),
      sink,
      maxBufferedFrames: 10,
    });

    clock.setEdge(T0);
    await vi.waitFor(() => {
      expect(sink.written).toEqual(["red"]);
    });

    clock.setEdge(T1);
    await vi.waitFor(() => {
      expect(sink.written).toEqual(["red", "green"]);
    });

    clock.setEdge(T2);
    await vi.waitFor(() => {
      expect(sink.written).toEqual(["red", "green", "blue"]);
    });
  });
});
