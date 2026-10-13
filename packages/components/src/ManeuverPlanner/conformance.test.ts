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

  // KSP recomputes remaining delta-v against the live orbit, so it can exceed the largest figure seen.
  it("never reports negative delivery when remaining exceeds the max seen", () => {
    const c = burnConformance(400, 300);

    expect(c.plannedDv).toBe(400);
    expect(c.deliveredDv).toBe(0);
    expect(c.deliveredFraction).toBe(0);
  });

  it("shares one threshold with the completion tracker", async () => {
    const tracker = await import("./BurnCompletionTracker");

    // Not a tautology: a second literal is how the two surfaces would drift apart.
    expect(DELIVERED_THRESHOLD_DV).toBe(tracker.COMPLETED_THRESHOLD_DV);
  });
});

describe("burnConformance with the thrust latch", () => {
  const latch = (lastThrustEndUt: number | null, thrusting = false) => ({
    lastThrustEndUt,
    thrusting,
  });

  it("is stopped-short when thrust ceased with delta-v still owed", () => {
    const c = burnConformance(120, 300, latch(500));

    expect(c.phase).toBe("stopped-short");
  });

  it("does not claim a shortfall once the burn is delivered", () => {
    const c = burnConformance(0.1, 300, latch(500));

    expect(c.phase).toBe("delivered");
  });

  it("stays in-progress while thrust has not ceased", () => {
    expect(burnConformance(120, 300, latch(null)).phase).toBe("in-progress");
  });

  it("treats a missing latch as no observation, never as a cessation", () => {
    expect(burnConformance(120, 300, undefined).phase).toBe("in-progress");
    expect(burnConformance(120, 300, null).phase).toBe("in-progress");
  });

  it("does not call an untouched burn stopped-short", () => {
    expect(burnConformance(300, 300, latch(500)).phase).toBe("not-started");
  });

  // lastThrustEndUt survives a relight; only `thrusting` separates a restarted burn.
  it("is not stopped-short while the craft is burning again", () => {
    const c = burnConformance(120, 300, latch(500, true));

    expect(c.phase).toBe("in-progress");
  });
});
