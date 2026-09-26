import { describe, expect, it } from "vitest";
import { describePartialDispatch } from "./partialDispatch";

describe("describePartialDispatch", () => {
  it("leads with what landed, then why it stopped", () => {
    expect(
      describePartialDispatch({
        dispatched: 3,
        total: 5,
        reason: "command lost: no confirmation within 11s",
      }),
    ).toBe(
      "3 of 5 burns dispatched. Burn 4 failed: command lost: no confirmation within 11s",
    );
  });

  it("names the burn that failed as the one AFTER those dispatched", () => {
    // An off-by-one here misnames the missing node, so the boundaries are pinned.
    expect(
      describePartialDispatch({ dispatched: 0, total: 4, reason: "x" }),
    ).toContain("Burn 1 failed");
    expect(
      describePartialDispatch({ dispatched: 3, total: 4, reason: "x" }),
    ).toContain("Burn 4 failed");
  });

  it("keeps the underlying reason verbatim rather than summarising it", () => {
    const reason = "vessel.maneuver.add rejected: NO_ACTIVE_VESSEL (code 7)";
    expect(
      describePartialDispatch({ dispatched: 1, total: 2, reason }),
    ).toContain(reason);
  });

  it("says only the reason for a single-burn plan", () => {
    expect(
      describePartialDispatch({ dispatched: 0, total: 1, reason: "timed out" }),
    ).toBe("timed out");
  });

  it("does not claim a count it cannot have, for an empty plan", () => {
    expect(
      describePartialDispatch({ dispatched: 0, total: 0, reason: "timed out" }),
    ).toBe("timed out");
  });
});
