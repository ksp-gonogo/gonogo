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
