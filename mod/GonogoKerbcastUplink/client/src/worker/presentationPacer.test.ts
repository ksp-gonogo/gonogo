import { describe, expect, it } from "vitest";
import { type PacedFrame, PresentationPacer } from "./presentationPacer";

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

    // Three frames ~33ms apart (30fps), all confirmed in the same instant —
    // exactly the burst DelayedPlayoutBuffer's pump() produces on a
    // sample-clamped edge step.
    pacer.submit(frame(100, "red"));
    pacer.submit(frame(100.033, "green"));
    pacer.submit(frame(100.066, "blue"));

    pacer.tick(0);
    expect(presented).toEqual(["red"]); // only the first — nothing else due yet

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

    // First tick lands late (0.05 instead of 0) — "a" presents at wall=0.05,
    // but "b"'s due time is anchored at 0.05 + 0.1 = 0.15, not 0 + 0.1 = 0.1.
    pacer.tick(0.05);
    expect(presented).toEqual(["a"]);

    pacer.tick(0.14);
    expect(presented).toEqual(["a"]); // b due at 0.15, not yet

    pacer.tick(0.151); // just past due — avoids float-precision flakiness at the exact boundary
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

    // ...but the caller doesn't get back around to ticking until wall=5 —
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
    // "stale-c" (ut=10) — spacing resumes cleanly from there, not stuck
    // waiting on the old pre-skip anchor.
    pacer.submit(frame(10.033, "fresh"));
    pacer.tick(20.02);
    expect(presented).toEqual(["a", "stale-c"]); // not due yet (due at 20.033)
    pacer.tick(20.04);
    expect(presented).toEqual(["a", "stale-c", "fresh"]);
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
    // empty — nothing left to present or skip).
    pacer.tick(100);
    expect(presented).toEqual(["a"]);
  });
});
