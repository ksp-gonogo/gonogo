/**
 * Single-delay-authority proof (M2 design §5.1 / §5.5 scenario 2, "headline
 * sync"). `DelayedPlayoutBuffer` is unit-tested against a hand-rolled
 * `manualClock` double in `./DelayedPlayoutBuffer.test.ts`; this file instead
 * drives it with the REAL `ViewClock` from `@ksp-gonogo/sitrep-client`, the same
 * clock instance telemetry reads its certainty horizon off, to prove the two
 * surfaces cross together off ONE authority, not two clocks that merely agree.
 *
 * The invariant under test: a media frame stamped UT=X becomes RELEASABLE at
 * exactly the same `confirmedEdgeUt()` crossing that flips a telemetry sample
 * stamped UT=X from `predicted` to `confirmed`. Whatever delay the one
 * authority applies (0 on LAN, N seconds under comms modelling) applies
 * identically to both: video and telemetry cannot drift apart by estimator
 * error, only by stamp error (§0 common-mode property).
 *
 * `ViewClock` is driven deterministically here the same way its own suite does:
 * an injected wall clock plus `observeSample` to advance the confirmed edge,
 * no real timers, no rAF. `buffer.pump()` is called explicitly after each clock
 * move (the buffer's `onFrame` subscription is real-time-only and irrelevant to
 * correctness: see `DelayedPlayoutBuffer`'s `pump` doc).
 */

import {
  type DelayClockLike,
  DelayedPlayoutBuffer,
  type StampedFrame,
} from "@ksp-gonogo/sitrep-sdk/media";
import { describe, expect, it } from "vitest";
import { ViewClock } from "../view-clock";

/** A media frame carrying an opaque token (a real `MediaStream` reference in
 *  production: see the camera Uplink's delayed-stream test docstring on why jsdom
 *  can't mint one). */
function frame(ut: number, token: string): StampedFrame<string> {
  return { ut, data: token, keyframe: true };
}

describe("DelayedPlayoutBuffer driven by the real ViewClock: one delay authority", () => {
  it("headline sync: a media frame and a telemetry sample stamped the same UT cross together (delay = 0)", () => {
    const wall = 1000;
    const clock = new ViewClock({
      nowWall: () => wall,
      delaySeconds: () => 0,
    });

    const released: StampedFrame<string>[] = [];
    const buffer = new DelayedPlayoutBuffer<string>({
      view: clock,
      onRelease: (f) => released.push(f),
      maxBufferedBytes: 64,
    });

    // A frame stamped UT=100 is pushed before anything is confirmed.
    buffer.push(frame(100, "frame@100"));
    buffer.pump();

    // Nothing observed yet: telemetry at UT=100 is PREDICTED and the media
    // frame is held, both off the same not-yet-confirmed edge.
    expect(clock.certaintyFor(100)).toBe("predicted");
    expect(released).toHaveLength(0);

    // The telemetry sample for UT=100 is delivered. This is the ONE event that
    // advances the shared edge to 100.
    clock.observeSample(100, 100);
    buffer.pump();

    // Same crossing: telemetry confirms AND the media frame releases.
    expect(clock.certaintyFor(100)).toBe("confirmed");
    expect(released.map((f) => f.data)).toEqual(["frame@100"]);
  });

  it("a frame stamped past the confirmed edge stays held exactly while telemetry at that UT is still predicted", () => {
    const wall = 0;
    const clock = new ViewClock({
      nowWall: () => wall,
      delaySeconds: () => 0,
    });

    const released: StampedFrame<string>[] = [];
    const buffer = new DelayedPlayoutBuffer<string>({
      view: clock,
      onRelease: (f) => released.push(f),
      maxBufferedBytes: 64,
    });

    clock.observeSample(100, 100); // edge now at 100
    buffer.push(frame(100, "at-edge"));
    buffer.push(frame(200, "past-edge"));
    buffer.pump();

    // The at-edge frame releases; the past-edge one is held, and telemetry
    // agrees: UT=100 confirmed, UT=200 predicted.
    expect(released.map((f) => f.data)).toEqual(["at-edge"]);
    expect(clock.certaintyFor(100)).toBe("confirmed");
    expect(clock.certaintyFor(200)).toBe("predicted");

    // A later sample advances the shared edge to 200, both flip together.
    clock.observeSample(200, 200);
    buffer.pump();
    expect(released.map((f) => f.data)).toEqual(["at-edge", "past-edge"]);
    expect(clock.certaintyFor(200)).toBe("confirmed");
  });

  it("the authority's delay applies equally to media and telemetry (delay > 0)", () => {
    const wall = 5000;
    const clock = new ViewClock({
      nowWall: () => wall,
      delaySeconds: () => 50,
    });

    const released: StampedFrame<string>[] = [];
    const buffer = new DelayedPlayoutBuffer<string>({
      view: clock,
      onRelease: (f) => released.push(f),
      maxBufferedBytes: 64,
    });

    // Sample delivered at UT=100 with a 50s delay: the confirmed edge lands at
    // utNowEstimate(100) - 50 = 50, clamped by maxSampleUt(100). Edge = 50.
    clock.observeSample(100, 100);
    expect(clock.confirmedEdgeUt()).toBe(50);

    buffer.push(frame(50, "delayed-releasable"));
    buffer.push(frame(100, "still-in-flight"));
    buffer.pump();

    // The frame at the delayed edge releases; the fresher one is held back by
    // the SAME 50s the telemetry certainty horizon is held back by.
    expect(released.map((f) => f.data)).toEqual(["delayed-releasable"]);
    expect(clock.certaintyFor(50)).toBe("confirmed");
    expect(clock.certaintyFor(100)).toBe("predicted");
  });

  it("shares the epoch reset: a timeline rewind + flush drops pre-reset frames so none surface post-epoch", () => {
    const wall = 0;
    const clock = new ViewClock({
      nowWall: () => wall,
      delaySeconds: () => 0,
    });

    const released: StampedFrame<string>[] = [];
    let resyncs = 0;
    const buffer = new DelayedPlayoutBuffer<string>({
      view: clock,
      onRelease: (f) => released.push(f),
      onResync: () => resyncs++,
      maxBufferedBytes: 64,
    });

    clock.observeSample(100, 100, 0);
    buffer.push(frame(80, "pre-reset"));
    buffer.pump();
    expect(released.map((f) => f.data)).toEqual(["pre-reset"]);

    // A rewind: telemetry bumps the shared clock's epoch and resets its edge;
    // the media buffer flushes on the same reset signal.
    clock.observeSample(10, 10, 1);
    buffer.flush();
    expect(resyncs).toBe(1);

    // Even as the post-reset edge sweeps forward again, nothing pre-reset that
    // was discarded can resurface.
    clock.observeSample(90, 90, 1);
    buffer.pump();
    expect(released.map((f) => f.data)).toEqual(["pre-reset"]);
  });

  /** A wall clock a test can advance explicitly, instead of racing real time,
   *  mirrors `view-clock.test.ts`'s `fakeWall`. */
  function fakeWall(start = 0) {
    let now = start;
    return {
      now: () => now,
      advanceBy: (seconds: number) => {
        now += seconds;
      },
    };
  }

  it("releases a media frame at the same wall-time a same-UT telemetry sample would confirm, driven by one shared confirmedEdgeUt clock", () => {
    const wall = fakeWall();
    // The real production delay authority: not a fake. Both "video" and
    // "telemetry" in this test read confirmedEdgeUt() off this one instance.
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 30,
    });
    // Wrap rather than pass the ViewClock instance directly so the test
    // doesn't schedule a real rAF/setTimeout tick via its onFrame, release
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
    // extra network transit modelled here: delaySeconds is the display-lag
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
    // step: the one shared clock makes them common-mode.
    wall.advanceBy(1);
    buffer.pump();
    expect(released).toHaveLength(1);
    expect(released[0]?.ut).toBe(SAME_UT);
    expect(telemetryConfirmed()).toBe(true);
  });
});
