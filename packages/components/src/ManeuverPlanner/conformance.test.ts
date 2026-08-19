import { describe, expect, it } from "vitest";
import { burnConformance, DELIVERED_THRESHOLD_DV } from "./conformance";

describe("burnConformance", () => {
  it("reports what was asked for, what is left, and what went in", () => {
    const c = burnConformance(120, 300);

    expect(c.plannedDv).toBe(300);
    expect(c.remainingDv).toBe(120);
    expect(c.deliveredDv).toBe(180);
    expect(c.deliveredFraction).toBeCloseTo(0.6, 6);
    expect(c.phase).toBe("in-progress");
  });

  // A single sample cannot tell a 300 m/s burn with 300 to go from a 1000 m/s
  // burn with 300 to go, and those conform very differently. Without a planned
  // figure the honest answer is that we do not know.
  it("is unknown without a planned figure, never a confident zero", () => {
    const c = burnConformance(300, null);

    expect(c.plannedDv).toBeNull();
    expect(c.deliveredDv).toBeNull();
    expect(c.deliveredFraction).toBeNull();
    expect(c.phase).toBe("unknown");
  });

  it("calls an untouched burn not-started rather than in-progress", () => {
    expect(burnConformance(300, 300).phase).toBe("not-started");
  });

  it("calls a burn delivered once almost nothing is left", () => {
    const c = burnConformance(DELIVERED_THRESHOLD_DV / 2, 300);

    expect(c.phase).toBe("delivered");
    expect(c.deliveredFraction).toBeGreaterThan(0.99);
  });

  // KSP recomputes a node's remaining delta-v against the live orbit, so it can
  // exceed the largest figure seen so far. Clamping planned UP keeps delivered
  // from going negative, which would render as a burn that un-burned itself.
  it("never reports negative delivery when remaining exceeds the max seen", () => {
    const c = burnConformance(400, 300);

    expect(c.plannedDv).toBe(400);
    expect(c.deliveredDv).toBe(0);
    expect(c.deliveredFraction).toBe(0);
  });

  it("shares one threshold with the completion tracker", async () => {
    const tracker = await import("./BurnCompletionTracker");

    // Not a tautology: the two surfaces must not be able to disagree about
    // whether the SAME burn finished, and a second literal here is exactly how
    // they would drift.
    expect(DELIVERED_THRESHOLD_DV).toBe(tracker.COMPLETED_THRESHOLD_DV);
  });
});

// ---------------------------------------------------------------------------
// stopped-short: the phase the thrust latch exists to make reachable.
//
// It was declared and documented before it was wired, so nothing could return
// it and nothing tested it. These come first, and they were watched failing
// against that state.
// ---------------------------------------------------------------------------
describe("burnConformance with the thrust latch", () => {
  const latch = (lastThrustEndUt: number | null, thrusting = false) => ({
    lastThrustEndUt,
    thrusting,
  });

  it("is stopped-short when thrust ceased with delta-v still owed", () => {
    const c = burnConformance(120, 300, latch(500));

    expect(c.phase).toBe("stopped-short");
  });

  // The label says what is KNOWN. It does not say the burn was under-flown,
  // because a burn paused to be re-planned and a burn abandoned produce the
  // same reading, and the difference is whether the operator comes back.
  it("does not claim a shortfall once the burn is delivered", () => {
    const c = burnConformance(0.1, 300, latch(500));

    expect(c.phase).toBe("delivered");
  });

  it("stays in-progress while thrust has not ceased", () => {
    expect(burnConformance(120, 300, latch(null)).phase).toBe("in-progress");
  });

  // Absent is not "engines off". A craft whose propulsion channel has not
  // arrived would otherwise have every burn on its plan announced as stopped
  // short of its target.
  it("treats a missing latch as no observation, never as a cessation", () => {
    expect(burnConformance(120, 300, undefined).phase).toBe("in-progress");
    expect(burnConformance(120, 300, null).phase).toBe("in-progress");
  });

  // A burn never started cannot have been stopped short of anything.
  it("does not call an untouched burn stopped-short", () => {
    expect(burnConformance(300, 300, latch(500)).phase).toBe("not-started");
  });

  // ThrustObserver does NOT clear lastThrustEndUt when the engines relight, so
  // a check on that field alone reports "stopped" while the craft is actively
  // burning. `thrusting` is what separates them, which is why the observation
  // carries both.
  it("is not stopped-short while the craft is burning again", () => {
    const c = burnConformance(120, 300, latch(500, true));

    expect(c.phase).toBe("in-progress");
  });
});
