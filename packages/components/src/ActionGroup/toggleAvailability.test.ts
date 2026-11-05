import { describe, expect, it } from "vitest";
import { unavailableReasonOf } from "./toggleAvailability";

const OPEN = {
  stateUnreadable: false,
  isPaused: false,
  commConnected: true,
  provenance: "reported" as const,
};

describe("unavailableReasonOf", () => {
  it("offers a press when nothing stands in its way, a held state included", () => {
    expect(unavailableReasonOf(OPEN)).toBeNull();
  });

  it("keeps the other reasons, in their order", () => {
    expect(unavailableReasonOf({ ...OPEN, stateUnreadable: true })).toBe(
      "State unreadable",
    );
    expect(unavailableReasonOf({ ...OPEN, isPaused: true })).toBe("Paused");
    expect(unavailableReasonOf({ ...OPEN, commConnected: false })).toBe(
      "No signal",
    );
    expect(unavailableReasonOf({ ...OPEN, provenance: "assumed" })).toBe(
      "Not reported",
    );
    expect(
      unavailableReasonOf({ ...OPEN, stateUnreadable: true, isPaused: true }),
    ).toBe("State unreadable");
  });
});
