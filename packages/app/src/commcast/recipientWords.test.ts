import { describe, expect, it } from "vitest";
import { recipientWords } from "./recipientWords";
import type { Delivery } from "./types";

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  to: "vessel:lab",
  separationSeconds: 12,
  lastSentUt: 0,
  attempts: 1,
  neverLeft: false,
  ...over,
});

describe("recipientWords", () => {
  it("says a message that never left names the craft having no electric charge when the plan does", () => {
    expect(
      recipientWords("lost", delivery({ neverLeft: true }), {
        noReachReason: "unpowered",
      }),
    ).toBe("never left, no electric charge aboard");
  });

  it("says no path when the plan gives no reason", () => {
    expect(recipientWords("lost", delivery({ neverLeft: true }))).toBe(
      "never left, no path",
    );
  });

  it("says a refused send was not sent, apart from one that went out unanswered", () => {
    expect(recipientWords("lost", delivery({ refused: true }))).toBe(
      "not sent, the game refused it",
    );
    expect(recipientWords("overdue", delivery())).toBe("not acknowledged");
  });

  it("says words the mod delivered and nobody answered were delivered, not that they were not received", () => {
    expect(recipientWords("overdue", delivery({ delivered: true }))).toBe(
      "delivered, no acknowledgement",
    );
  });

  it("says nobody is at a centre that cannot answer, so the silence is not a failure of the send", () => {
    expect(
      recipientWords("overdue", delivery({ delivered: true }), {
        staffed: false,
      }),
    ).toBe("delivered, nobody is at its centre to answer");
    expect(recipientWords("overdue", delivery(), { staffed: false })).toBe(
      "not acknowledged, nobody is at its centre to answer",
    );
    expect(
      recipientWords("overdue", delivery({ delivered: true }), {
        staffed: true,
      }),
    ).toBe("delivered, no acknowledgement");
  });

  it("does not name a reason for a message that did leave", () => {
    const about = { noReachReason: "unpowered" as const };
    expect(recipientWords("overdue", delivery(), about)).toBe(
      "not acknowledged",
    );
    expect(recipientWords("in-transit", delivery(), about)).toBe("on the way");
    expect(recipientWords("confirmed", delivery(), about)).toBe("received");
  });
});
