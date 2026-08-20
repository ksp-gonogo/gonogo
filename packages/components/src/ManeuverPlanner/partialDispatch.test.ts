import { describe, expect, it } from "vitest";
import { describePartialDispatch } from "./partialDispatch";

/**
 * The operator-facing half of the dropped-command fix. Settling the promise stops the
 * commit loop hanging; this stops the resulting error leaving them in the same
 * epistemic position as the hang did, knowing something failed and not knowing what is
 * on the vessel.
 */
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
    // Off-by-one here is a confident lie about which node is missing, so it is worth
    // pinning at the boundaries rather than only in the middle.
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

  /*
   * A single-burn plan has nothing to count: nothing landed and nothing was abandoned,
   * so "0 of 1 burns dispatched" is noise in front of the only fact there is. The
   * count earns its place only when it tells the operator something.
   */
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
