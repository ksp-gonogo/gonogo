/**
 * `DelayedPlayoutBuffer` scenario tests — the goal-doc list from
 * `local_docs/telemetry-mod/m2-sdk-delay-design.md` §5.5, in priority
 * order. Courier delay-test discipline throughout: inject UT-stamped
 * frames (the "mock media stream" — plain stand-in payloads, since a real
 * browser `MediaStream` can't be produced or frame-decomposed in jsdom;
 * see `CameraFeed.test.tsx`'s docstring), drive a manually-controlled
 * clock, assert release timing.
 *
 * Scenario 2 (the headline video↔telemetry sync test) drives the real
 * `@ksp-gonogo/sitrep-client` `ViewClock` — the actual production delay
 * authority — rather than a fake, to prove the buffer and a simulated
 * telemetry-confirmation read genuinely share one clock object. Every
 * other scenario uses a lightweight manual clock double (mirrors
 * `view-clock.test.ts`'s `fakeWall` / `courier-transport.integration.test`'s
 * `ManualClock.advanceTo` pattern) since they don't need the real
 * UT-estimator fit, just direct control over `confirmedEdgeUt()`.
 */

import { ViewClock } from "@ksp-gonogo/sitrep-client";
import { describe, expect, it, vi } from "vitest";
import {
  type DelayClockLike,
  DelayedPlayoutBuffer,
  type StampedFrame,
} from "./DelayedPlayoutBuffer";

/** A clock double a test can set directly, standing in for confirmedEdgeUt.
 *  `setEdge` both advances the value and fires the buffer's per-frame
 *  subscription — the deterministic substitute for a real rAF tick. */
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

/** A wall clock a test can advance explicitly, instead of racing real time
 *  — mirrors `view-clock.test.ts`'s `fakeWall`. */
function fakeWall(start = 0) {
  let now = start;
  return {
    now: () => now,
    advanceBy: (seconds: number) => {
      now += seconds;
    },
  };
}

describe("DelayedPlayoutBuffer", () => {
  // -- Scenario 1: basic delayed release -----------------------------------
  it("releases a frame stamped capture-UT C only once confirmedEdgeUt() reaches C, not before", () => {
    const clock = manualClock(0);
    const released: StampedFrame[] = [];
    const buffer = new DelayedPlayoutBuffer({
      view: clock,
      onRelease: (f) => released.push(f),
      maxBufferedBytes: 10_000,
    });

    buffer.push({ ut: 100, keyframe: true, data: "frame@100" });
    expect(released).toHaveLength(0);
    expect(buffer.current()).toBeUndefined();

    // Edge advances but hasn't reached 100 yet — still held.
    clock.setEdge(99);
    expect(released).toHaveLength(0);

    // Edge crosses 100 (capture-UT + delay, in wall-time terms) — releases.
    clock.setEdge(100);
    expect(released).toEqual([{ ut: 100, keyframe: true, data: "frame@100" }]);
    expect(buffer.current()).toEqual({
      ut: 100,
      keyframe: true,
      data: "frame@100",
    });
  });

  // -- Scenario 2: THE headline video<->telemetry sync test ----------------
  it("releases a media frame at the same wall-time a same-UT telemetry sample would confirm, driven by one shared confirmedEdgeUt clock", () => {
    const wall = fakeWall();
    // The real production delay authority — not a fake. Both "video" and
    // "telemetry" in this test read confirmedEdgeUt() off this one instance.
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 30,
    });
    // Wrap rather than pass the ViewClock instance directly so the test
    // doesn't schedule a real rAF/setTimeout tick via its onFrame — release
    // timing is driven explicitly via pump() for determinism.
    const clockView: DelayClockLike = {
      confirmedEdgeUt: () => clock.confirmedEdgeUt(),
      onFrame: () => () => {},
    };

    const released: StampedFrame[] = [];
    const buffer = new DelayedPlayoutBuffer({
      view: clockView,
      onRelease: (f) => released.push(f),
      maxBufferedBytes: 10_000,
    });

    const SAME_UT = 500;
    buffer.push({ ut: SAME_UT, keyframe: true, data: "frame@500" });

    // A telemetry sample stamped the identical UT is observed by the same
    // clock instance (deliveredAt = SAME_UT: the observation lands with no
    // extra network transit modelled here — delaySeconds is the display-lag
    // policy under test, not courier network delay).
    clock.observeSample(SAME_UT, SAME_UT);
    const telemetryConfirmed = () => clock.confirmedEdgeUt() >= SAME_UT;

    // Before the delay elapses: neither the frame nor the telemetry sample
    // has crossed the confirmed edge.
    wall.advanceBy(29);
    buffer.pump();
    expect(released).toHaveLength(0);
    expect(telemetryConfirmed()).toBe(false);

    // At exactly delaySeconds elapsed, BOTH cross in the same wall-time
    // step — the one shared clock makes them common-mode.
    wall.advanceBy(1);
    buffer.pump();
    expect(released).toHaveLength(1);
    expect(released[0]?.ut).toBe(SAME_UT);
    expect(telemetryConfirmed()).toBe(true);
  });

  // -- Scenario 3: delay-value change ---------------------------------------
  it("adjusts buffer depth as the delay grows/shrinks without losing a frame or releasing one early", () => {
    const clock = manualClock(0);
    const released: number[] = [];
    const buffer = new DelayedPlayoutBuffer({
      view: clock,
      onRelease: (f) => released.push(f.ut),
      maxBufferedBytes: 10_000,
    });

    buffer.push({ ut: 10, keyframe: true });
    buffer.push({ ut: 20, keyframe: false });
    buffer.push({ ut: 30, keyframe: false });

    // A larger delay: edge sits below all three — nothing released early.
    clock.setEdge(5);
    expect(released).toEqual([]);

    // Delay shrinks — edge jumps forward; frames release in UT order, none
    // skipped (no gap), none double-released.
    clock.setEdge(20);
    expect(released).toEqual([10, 20]);

    // Delay grows again (edge stalls) — the still-queued frame (30) stays
    // held, not shown early.
    clock.setEdge(20);
    expect(released).toEqual([10, 20]);

    // Edge eventually reaches the last frame.
    clock.setEdge(30);
    expect(released).toEqual([10, 20, 30]);
  });

  // -- Scenario 4: quickload / timeline-reset --------------------------------
  it("flushes buffered frames and emits a resync marker on a timeline reset; no pre-reset frame ever shows afterward", () => {
    const clock = manualClock(0);
    const released: number[] = [];
    const onResync = vi.fn();
    const buffer = new DelayedPlayoutBuffer({
      view: clock,
      onRelease: (f) => released.push(f.ut),
      onResync,
      maxBufferedBytes: 10_000,
    });

    buffer.push({ ut: 100, keyframe: true });
    buffer.push({ ut: 110, keyframe: false });
    expect(buffer.peekQueue()).toHaveLength(2);

    buffer.flush();
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(buffer.peekQueue()).toHaveLength(0);
    expect(buffer.current()).toBeUndefined();

    // Even once the (post-reset) clock sweeps far past the discarded UTs,
    // those old frames never surface — they were dropped, not just held.
    clock.setEdge(1000);
    expect(released).toEqual([]);

    // Fresh post-reset frames (a rewind can restart UT numbering low) still
    // release normally.
    buffer.push({ ut: 5, keyframe: true });
    clock.setEdge(5);
    expect(released).toEqual([5]);
  });

  // -- Scenario 5: lossy bounds ------------------------------------------
  it("over the byte cap, drops the oldest non-keyframe frame first — a keyframe survives", () => {
    // Edge never advances, so nothing releases and frames simply accumulate.
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const released: StampedFrame[] = [];
    const buffer = new DelayedPlayoutBuffer({
      view: clock,
      onRelease: (f) => released.push(f),
      maxBufferedBytes: 3, // 1 byte/frame here -> cap of 3 queued frames
    });

    buffer.push({ ut: 1, keyframe: true, bytes: 1 }); // oldest, a keyframe
    buffer.push({ ut: 2, keyframe: false, bytes: 1 }); // oldest delta
    buffer.push({ ut: 3, keyframe: false, bytes: 1 });
    buffer.push({ ut: 4, keyframe: false, bytes: 1 }); // pushes over cap

    // ut=2 (the oldest non-keyframe) was dropped; the keyframe (ut=1)
    // survives even though it's older than the dropped delta.
    expect(buffer.peekQueue().map((f) => f.ut)).toEqual([1, 3, 4]);
    expect(released).toEqual([]);

    // A second delta arrives — the next-oldest delta (ut=3) goes, the
    // keyframe still survives.
    buffer.push({ ut: 5, keyframe: false, bytes: 1 });
    expect(buffer.peekQueue().map((f) => f.ut)).toEqual([1, 4, 5]);

    // Once only keyframes remain over cap, the eviction has no non-keyframe
    // to trade away and stops rather than stalling — never blocks ingest.
    const kfOnly = new DelayedPlayoutBuffer({
      view: manualClock(Number.NEGATIVE_INFINITY),
      onRelease: () => {},
      maxBufferedBytes: 2,
    });
    kfOnly.push({ ut: 1, keyframe: true, bytes: 1 });
    kfOnly.push({ ut: 2, keyframe: true, bytes: 1 });
    kfOnly.push({ ut: 3, keyframe: true, bytes: 1 }); // over cap, all keyframes
    // Last-resort: the oldest keyframe is dropped rather than growing
    // unboundedly — cap is still respected.
    expect(kfOnly.peekQueue().map((f) => f.ut)).toEqual([2, 3]);
  });

  // -- Scenario 6: delay=0 (LAN) passthrough --------------------------------
  it("delay=0: a frame releases immediately when confirmedEdgeUt is already at the frame's UT (strict passthrough)", () => {
    const clock = manualClock(0); // edge already caught up — no delay modelled
    const released: StampedFrame[] = [];
    const buffer = new DelayedPlayoutBuffer({
      view: clock,
      onRelease: (f) => released.push(f),
      maxBufferedBytes: 10_000,
    });

    buffer.push({ ut: 0, keyframe: true, data: "live-frame" });
    // Released synchronously on push — no held-back wait, existing
    // LAN-latency CameraFeed behaviour is unaffected.
    expect(released).toEqual([{ ut: 0, keyframe: true, data: "live-frame" }]);

    buffer.push({ ut: 1, keyframe: false, data: "live-frame-2" });
    clock.setEdge(1);
    expect(released).toHaveLength(2);
    expect(released[1]?.data).toBe("live-frame-2");
  });

  it("dispose() unsubscribes from the clock's onFrame and stops accepting frames", () => {
    const clock = manualClock(0);
    const released: StampedFrame[] = [];
    const buffer = new DelayedPlayoutBuffer({
      view: clock,
      onRelease: (f) => released.push(f),
      maxBufferedBytes: 10_000,
    });

    buffer.dispose();
    buffer.push({ ut: 0, keyframe: true, data: "late-frame" });
    clock.setEdge(0);
    expect(released).toEqual([]);
  });
});
