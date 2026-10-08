import { describe, expect, it } from "vitest";
import { commSignalScenario, controlStateAt } from "./commSignalModel";
import { booleanAt, numberAt, sentOn } from "./frameValue";

describe("the blackout seen from the signal widget", () => {
  const { frames } = commSignalScenario();
  const vessel = (i: number) => sentOn(frames[i], "vessel.comms");
  const connected = (i: number) => booleanAt(vessel(i), "connected");
  const strength = (i: number) => numberAt(vessel(i), "signalStrength");

  it("opens with no link and ends with one", () => {
    expect(connected(0)).toBe(false);
    expect(connected(frames.length - 1)).toBe(true);
  });

  it("loses all control in the blackout and keeps full control at the start of a good link", () => {
    expect(controlStateAt(11)).toBe(0);
    expect(controlStateAt(6)).toBe(4);
  });

  it("lets the strength fall before the link goes, not after", () => {
    expect(strength(18)).toBeLessThan(strength(12));
    expect(connected(18)).toBe(true);
  });

  it("samples every half second across the whole timeline", () => {
    expect(frames).toHaveLength(37);
  });
});
