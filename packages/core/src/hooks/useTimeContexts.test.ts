import { describe, expect, it } from "vitest";
import { deriveTimeContexts } from "./useTimeContexts";

describe("deriveTimeContexts", () => {
  it("offers no qualifier on a LAN session, where the two clocks are one clock", () => {
    expect(deriveTimeContexts(0, "KSC")).toEqual({
      owltSeconds: 0,
      scet: undefined,
      received: undefined,
    });
  });

  /* The rule is "show it only when they differ", read at the resolution a
     mission date is drawn to. A craft in low orbit is a few milliseconds away
     and prints the same string on both clocks, so qualifying it puts a label
     on every instant on the screen and teaches the operator to skip them. */
  it("offers no qualifier for a gap too small to change the rendered time", () => {
    expect(deriveTimeContexts(0.004, "KSC").scet).toBeUndefined();
  });

  it("qualifies both clocks once the gap is visible, naming the vantage", () => {
    expect(deriveTimeContexts(240, "KSC")).toEqual({
      owltSeconds: 240,
      scet: { frame: "scet" },
      received: { frame: "received", vantage: "KSC" },
    });
  });

  it("still qualifies when no vantage has been named yet", () => {
    expect(deriveTimeContexts(240, undefined).received).toEqual({
      frame: "received",
      vantage: undefined,
    });
  });

  /* A negative or non-finite delay is not evidence that the craft got closer,
     and zero is the one direction this must never fail in: a fabricated zero
     drops the qualifier from every instant at exactly the moment the reading
     went wrong. It reports 0 and says nothing, rather than reporting a gap it
     cannot stand behind. */
  it("treats a malformed delay as no measurable gap", () => {
    expect(deriveTimeContexts(Number.NaN, "KSC").owltSeconds).toBe(0);
    expect(deriveTimeContexts(-30, "KSC").scet).toBeUndefined();
  });
});
