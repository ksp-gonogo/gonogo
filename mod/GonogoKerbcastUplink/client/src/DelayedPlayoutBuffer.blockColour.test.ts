/**
 * Deterministic "block-colour" proof that `DelayedPlayoutBuffer` applies
 * the signal delay correctly, per the followup-delayproof task: the live
 * camera isn't visibly delayed right now (a separate, kerbcast-side runtime
 * issue), so this test isolates gonogo's half of the contract and proves it
 * in isolation, independent of any real `MediaStream`/WebRTC plumbing.
 *
 * Each "frame" is a solid, distinguishable colour token (`"red"` /
 * `"green"` / `"blue"`) stamped with a known capture UT, so the current
 * output colour can be read directly off `buffer.current()?.data` at any
 * instant. Reuses `DelayedPlayoutBuffer.test.ts`'s `manualClock` double
 * (edge set directly, no real timers) rather than mocking anything.
 *
 * Two required cases:
 *   1. delay D > 0 — each colour must surface at exactly `capturedUt + D`,
 *      never a moment before (boundary-tested at just-before / at /
 *      just-after each threshold).
 *   2. the control — same colour sequence with D = 0 flips the instant each
 *      frame is captured, proving it's the delay (not some other lag)
 *      responsible for case 1's hold-back.
 */

import { describe, expect, it } from "vitest";
import {
  type DelayClockLike,
  DelayedPlayoutBuffer,
} from "./DelayedPlayoutBuffer";

/** A clock double a test can set directly, standing in for confirmedEdgeUt.
 *  Mirrors `DelayedPlayoutBuffer.test.ts`'s `manualClock`. */
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

describe("DelayedPlayoutBuffer — block-colour delay proof", () => {
  const T0 = 100; // red captured
  const T1 = 101; // green captured
  const T2 = 102; // blue captured

  it("with delay D > 0, each colour surfaces exactly D seconds after its capture UT, never before", () => {
    const D = 5;
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const released: string[] = [];
    const buffer = new DelayedPlayoutBuffer<string>({
      view: clock,
      onRelease: (f) => {
        if (f.data) released.push(f.data);
      },
      maxBufferedBytes: 10_000,
    });

    // All three colours are already captured and queued, waiting on the
    // delayed clock — mirrors a real stream where frames arrive well
    // before the delayed edge catches up to them.
    buffer.push({ ut: T0, keyframe: true, data: "red" });
    buffer.push({ ut: T1, keyframe: true, data: "green" });
    buffer.push({ ut: T2, keyframe: true, data: "blue" });
    expect(released).toEqual([]);
    expect(buffer.current()).toBeUndefined();

    const edgeFor = (t: number) => t - D;

    // Just before red's due instant (T0 + D): still nothing shown.
    clock.setEdge(edgeFor(T0 + D - 1));
    expect(buffer.current()).toBeUndefined();
    expect(released).toEqual([]);

    // Exactly at T0 + D: red releases, not a moment sooner.
    clock.setEdge(edgeFor(T0 + D));
    expect(buffer.current()?.data).toBe("red");
    expect(released).toEqual(["red"]);

    // Just after: still red — green isn't due yet.
    clock.setEdge(edgeFor(T0 + D + 0.5));
    expect(buffer.current()?.data).toBe("red");
    expect(released).toEqual(["red"]);

    // Just before green's due instant (T1 + D): still red.
    clock.setEdge(edgeFor(T1 + D - 1));
    expect(buffer.current()?.data).toBe("red");
    expect(released).toEqual(["red"]);

    // Exactly at T1 + D: green releases.
    clock.setEdge(edgeFor(T1 + D));
    expect(buffer.current()?.data).toBe("green");
    expect(released).toEqual(["red", "green"]);

    // Just before blue's due instant (T2 + D): still green.
    clock.setEdge(edgeFor(T2 + D - 1));
    expect(buffer.current()?.data).toBe("green");
    expect(released).toEqual(["red", "green"]);

    // Exactly at T2 + D: blue releases.
    clock.setEdge(edgeFor(T2 + D));
    expect(buffer.current()?.data).toBe("blue");
    expect(released).toEqual(["red", "green", "blue"]);

    // Long after: still blue — no phantom fourth colour, nothing early.
    clock.setEdge(edgeFor(T2 + D + 100));
    expect(buffer.current()?.data).toBe("blue");
    expect(released).toEqual(["red", "green", "blue"]);
  });

  it("control: with no delay (D = 0), the same colour sequence flips the instant each frame is captured — no lag", () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const released: string[] = [];
    const buffer = new DelayedPlayoutBuffer<string>({
      view: clock,
      onRelease: (f) => {
        if (f.data) released.push(f.data);
      },
      maxBufferedBytes: 10_000,
    });

    // Edge tracks capture time directly (D = 0): a frame pushed the instant
    // it's captured releases synchronously on that same push — same buffer,
    // same path as the delayed case above, just with D = 0.
    clock.setEdge(T0);
    buffer.push({ ut: T0, keyframe: true, data: "red" });
    expect(buffer.current()?.data).toBe("red");
    expect(released).toEqual(["red"]);

    clock.setEdge(T1);
    buffer.push({ ut: T1, keyframe: true, data: "green" });
    expect(buffer.current()?.data).toBe("green");
    expect(released).toEqual(["red", "green"]);

    clock.setEdge(T2);
    buffer.push({ ut: T2, keyframe: true, data: "blue" });
    expect(buffer.current()?.data).toBe("blue");
    expect(released).toEqual(["red", "green", "blue"]);
  });
});
