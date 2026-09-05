import { describe, expect, it } from "vitest";
import { type PacedFrame, PresentationPacer } from "./presentation-pacer";

function frame(ut: number, label: string): PacedFrame<string> {
  return { ut, data: label };
}

describe("PresentationPacer", () => {
  it("presents a single frame immediately on the first tick, with no artificial delay", () => {
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 1,
    });

    pacer.submit(frame(100, "a"));
    pacer.tick(0);

    expect(presented).toEqual(["a"]);
  });

  it("a burst of frames confirmed at once (F3's sample-clamped release) is presented spaced by their own UT deltas, not dumped synchronously", () => {
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 1,
    });

    // Three frames ~33ms apart (30fps), all confirmed in the same instant,
    // exactly the burst DelayedPlayoutBuffer's pump() produces on a
    // sample-clamped edge step.
    pacer.submit(frame(100, "red"));
    pacer.submit(frame(100.033, "green"));
    pacer.submit(frame(100.066, "blue"));

    pacer.tick(0);
    expect(presented).toEqual(["red"]); // only the first: nothing else due yet

    pacer.tick(0.02);
    expect(presented).toEqual(["red"]); // green not due until wall=0.033

    pacer.tick(0.04);
    expect(presented).toEqual(["red", "green"]);

    pacer.tick(0.05);
    expect(presented).toEqual(["red", "green"]); // blue not due until wall=0.066

    pacer.tick(0.07);
    expect(presented).toEqual(["red", "green", "blue"]);
  });

  it("anchors spacing on the SCHEDULED due time, not the actual tick time, so irregular ticks don't compound drift", () => {
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 1,
    });

    pacer.submit(frame(0, "a"));
    pacer.submit(frame(0.1, "b"));
    pacer.submit(frame(0.2, "c"));

    // First tick lands late (0.05 instead of 0), "a" presents at wall=0.05,
    // but "b"'s due time is anchored at 0.05 + 0.1 = 0.15, not 0 + 0.1 = 0.1.
    pacer.tick(0.05);
    expect(presented).toEqual(["a"]);

    pacer.tick(0.14);
    expect(presented).toEqual(["a"]); // b due at 0.15, not yet

    pacer.tick(0.151); // just past due: avoids float-precision flakiness at the exact boundary
    expect(presented).toEqual(["a", "b"]);

    // c's due time is anchored on b's SCHEDULED due (0.15), not the actual
    // tick(0.151) instant (they're equal-ish here, so use a later tick to
    // prove it's not drifting off the actual-tick timestamps that preceded
    // it).
    pacer.tick(0.24);
    expect(presented).toEqual(["a", "b"]); // c due at 0.25

    pacer.tick(0.251);
    expect(presented).toEqual(["a", "b", "c"]);
  });

  it("never presents a frame before its due wall time (never advances presentation)", () => {
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 1,
    });

    pacer.submit(frame(0, "a"));
    pacer.tick(0);
    pacer.submit(frame(5, "b")); // 5 UT-seconds later -> due at wall 5

    pacer.tick(1);
    expect(presented).toEqual(["a"]); // b still not due
    pacer.tick(4.999);
    expect(presented).toEqual(["a"]);
    pacer.tick(5);
    expect(presented).toEqual(["a", "b"]);
  });

  it("large backlog skips to the newest queued frame instead of draining in slow motion, dropping the rest via onSkip", () => {
    const presented: string[] = [];
    const skipped: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      onSkip: (f) => skipped.push(f.data),
      maxBacklogSeconds: 0.5,
    });

    pacer.submit(frame(0, "a"));
    pacer.tick(0);
    expect(presented).toEqual(["a"]);

    // Normal small gaps queued next...
    pacer.submit(frame(0.1, "b"));
    pacer.submit(frame(0.2, "c"));
    pacer.submit(frame(0.3, "d"));

    // ...but the caller doesn't get back around to ticking until wall=5,
    // the worker/main-thread stalled, or bursts kept arriving faster than
    // they drained. "b" was due at wall=0.1; backlog = 5 - 0.1 = 4.9,
    // way past maxBacklogSeconds (0.5).
    pacer.tick(5);

    expect(presented).toEqual(["a", "d"]); // jumped straight to the newest
    expect(skipped).toEqual(["b", "c"]); // the stale middle frames were dropped
  });

  it("resumes normal spacing (no lingering backlog) after a skip-to-newest", () => {
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 0.5,
    });

    pacer.submit(frame(0, "a"));
    pacer.tick(0);
    pacer.submit(frame(0.1, "b"));
    pacer.submit(frame(10, "stale-c"));
    pacer.tick(20); // huge backlog -> skip to "stale-c"
    expect(presented).toEqual(["a", "stale-c"]);

    // New frame arrives with a normal small delta from the just-presented
    // "stale-c" (ut=10): spacing resumes cleanly from there, not stuck
    // waiting on the old pre-skip anchor.
    pacer.submit(frame(10.033, "fresh"));
    pacer.tick(20.02);
    expect(presented).toEqual(["a", "stale-c"]); // not due yet (due at 20.033)
    pacer.tick(20.04);
    expect(presented).toEqual(["a", "stale-c", "fresh"]);
  });

  it("paces on the rate frames are ARRIVING at, not on their own UT deltas", () => {
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 10,
      rateBaselineSeconds: 0.2,
      maxRateDeparture: 0.2,
    });

    // Eleven frames on a 20 ms UT grid, arriving 18 ms apart: the shape a
    // separation closing at a tenth of the speed of light gives a stream.
    for (let i = 0; i <= 10; i++) {
      pacer.submit(frame(i * 0.02, `f${i}`), i * 0.018);
    }

    pacer.tick(0);
    expect(presented).toEqual(["f0"]);

    // f1 is due 18 ms on, the rate it arrived at, NOT the 20 ms it was stamped
    // at. Read as a wall delta the stamp would hold it back another two.
    pacer.tick(0.017);
    expect(presented).toEqual(["f0"]);
    pacer.tick(0.019);
    expect(presented).toEqual(["f0", "f1"]);

    pacer.tick(0.035);
    expect(presented).toEqual(["f0", "f1"]);
    pacer.tick(0.037);
    expect(presented).toEqual(["f0", "f1", "f2"]);
  });

  it("measures the arrival rate ACROSS release bursts, never inside one", () => {
    /*
     * `DelayedPlayoutBuffer` releases everything at-or-before a stepped edge in
     * one synchronous pass, so five frames share one arrival instant. Read as a
     * gap between consecutive arrivals that is a rate of zero, and it would
     * clamp to the fast edge of the band and compress every stream that ever
     * bursts, which is all of them.
     */
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 10,
      rateBaselineSeconds: 0.2,
      maxRateDeparture: 0.2,
    });

    // Five frames per burst on the 20 ms grid, one burst per 100 ms of source
    // timeline, arriving 90 ms apart: the same 0.9 as above, in bursts.
    for (let burst = 0; burst <= 4; burst++) {
      for (let i = 0; i < 5; i++) {
        pacer.submit(
          frame(burst * 0.1 + i * 0.02, `b${burst}i${i}`),
          burst * 0.09,
        );
      }
    }

    pacer.tick(0);
    expect(presented).toEqual(["b0i0"]);
    pacer.tick(0.019);
    expect(presented).toEqual(["b0i0", "b0i1"]);
    pacer.tick(0.037);
    expect(presented).toEqual(["b0i0", "b0i1", "b0i2"]);
  });

  it("anchors the baseline on the far end of the first burst, not on its first frame", () => {
    /*
     * The first release pass after a light-time has elapsed hands over
     * everything that was queued behind it, so burst zero is routinely far
     * bigger than the ones that follow. Anchored on its FIRST frame the
     * baseline carries that whole burst as UT that no wall time was spent
     * delivering, and the rate reads far slower than the stream really is.
     * Both ends of the baseline have to be the same kind of endpoint.
     */
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 10,
      rateBaselineSeconds: 0.2,
      maxRateDeparture: 0.2,
    });

    // Ten frames in the opening burst, five in each of the four that follow,
    // one burst per 100 ms of source timeline arriving 90 ms apart: 0.9 again.
    for (let i = 0; i < 10; i++) pacer.submit(frame(i * 0.02, `a${i}`), 0);
    for (let burst = 1; burst <= 4; burst++) {
      for (let i = 0; i < 5; i++) {
        pacer.submit(
          frame(0.18 + (burst - 1) * 0.1 + (i + 1) * 0.02, `b${burst}i${i}`),
          burst * 0.09,
        );
      }
    }

    pacer.tick(0);
    expect(presented).toEqual(["a0"]);
    // Due 18 ms on. Anchored on the first frame of the opening burst the rate
    // reads 0.56, clamps to the fast edge of the band, and presents here.
    pacer.tick(0.017);
    expect(presented).toEqual(["a0"]);
    pacer.tick(0.019);
    expect(presented).toEqual(["a0", "a1"]);
  });

  it("holds natural rate when the ratio is a time warp rather than a separation", () => {
    /*
     * The warp position, unchanged: play at natural rate, let the backlog grow,
     * report it. A measured rate that chased a 2x warp would play a
     * conversation back at double speed, and the band exists to refuse that
     * while still following every separation rate this game can produce.
     */
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 10,
      rateBaselineSeconds: 0.2,
      maxRateDeparture: 0.2,
    });

    // A UT second per half wall second: 2x, the slowest warp step there is.
    for (let i = 0; i <= 20; i++) {
      pacer.submit(frame(i * 0.02, `f${i}`), i * 0.01);
    }

    pacer.tick(0);
    // Held at the fast edge of the band (0.8 x 20 ms = 16 ms), not at the 10 ms
    // the arrivals would have justified.
    pacer.tick(0.015);
    expect(presented).toEqual(["f0"]);
    pacer.tick(0.017);
    expect(presented).toEqual(["f0", "f1"]);
  });

  it("spaces on UT deltas exactly as before when no arrival instant is given", () => {
    // The opt-in half of the contract: the video pipeline submits without one
    // and must keep the behaviour every other test here pins.
    const presented: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      maxBacklogSeconds: 10,
      rateBaselineSeconds: 0.2,
    });

    for (let i = 0; i <= 20; i++) pacer.submit(frame(i * 0.02, `f${i}`));

    pacer.tick(0);
    pacer.tick(0.019);
    expect(presented).toEqual(["f0"]);
    pacer.tick(0.021);
    expect(presented).toEqual(["f0", "f1"]);
  });

  it("dispose() drops everything still queued via onSkip, without presenting it", () => {
    const presented: string[] = [];
    const skipped: string[] = [];
    const pacer = new PresentationPacer<string>({
      onPresent: (f) => presented.push(f.data),
      onSkip: (f) => skipped.push(f.data),
      maxBacklogSeconds: 1,
    });

    pacer.submit(frame(0, "a"));
    pacer.tick(0);
    pacer.submit(frame(1, "b"));
    pacer.submit(frame(2, "c"));

    pacer.dispose();

    expect(presented).toEqual(["a"]);
    expect(skipped).toEqual(["b", "c"]);

    // Idempotent-ish: ticking after dispose does nothing further (queue is
    // empty: nothing left to present or skip).
    pacer.tick(100);
    expect(presented).toEqual(["a"]);
  });
});
