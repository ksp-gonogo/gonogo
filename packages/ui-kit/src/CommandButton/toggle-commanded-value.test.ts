import { describe, expect, it } from "vitest";
import type { InFlightCommandLike } from "../CommandDelay/toInFlightListItems";
import { modelledToggleState } from "./toggle";

function foreign(over: Partial<InFlightCommandLike> = {}): InFlightCommandLike {
  return {
    id: "centre:1",
    label: "Gear",
    command: "vessel.control.setGear",
    reachEtaSeconds: 0,
    replyEtaSeconds: 4,
    predictedPhase: "awaiting-reply",
    ...over,
  };
}

describe("a toggle pressed on another screen", () => {
  it("shows the state it commanded, not a flip of the reading", () => {
    expect(
      modelledToggleState(true, undefined, [foreign({ commandedValue: 1 })]),
    ).toBe(true);
    expect(
      modelledToggleState(false, undefined, [foreign({ commandedValue: 0 })]),
    ).toBe(false);
  });

  it("is read as a flip only when the centre reports no value", () => {
    expect(modelledToggleState(true, undefined, [foreign()])).toBe(false);
  });

  it("follows the commanded values in arrival order", () => {
    expect(
      modelledToggleState(false, undefined, [
        foreign({ id: "centre:1", dispatchedAt: 1, commandedValue: 1 }),
        foreign({ id: "centre:2", dispatchedAt: 2, commandedValue: 1 }),
      ]),
    ).toBe(true);
  });
});
