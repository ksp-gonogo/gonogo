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

  it("says a refused send was not sent, apart from one with no arrival recorded", () => {
    expect(recipientWords("lost", delivery({ refused: true }))).toBe(
      "not sent, the game refused it",
    );
    expect(recipientWords("overdue", delivery())).toBe("no arrival recorded");
  });

  it("says a confirmed delivery was delivered, and read only when a read came back", () => {
    expect(recipientWords("confirmed", delivery())).toBe("delivered");
    expect(recipientWords("confirmed", delivery(), {}, true)).toBe(
      "delivered, read",
    );
  });

  it("does not name a reason for a message that did leave", () => {
    const about = { noReachReason: "unpowered" as const };
    expect(recipientWords("overdue", delivery(), about)).toBe(
      "no arrival recorded",
    );
    expect(recipientWords("in-transit", delivery(), about)).toBe("on the way");
  });
});
