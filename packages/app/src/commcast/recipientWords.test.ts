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
      recipientWords("lost", delivery({ neverLeft: true }), "unpowered"),
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
    expect(recipientWords("overdue", delivery())).toBe("not received");
  });

  it("does not name a reason for a message that did leave", () => {
    expect(recipientWords("overdue", delivery(), "unpowered")).toBe(
      "not received",
    );
    expect(recipientWords("in-transit", delivery(), "unpowered")).toBe(
      "on the way",
    );
    expect(recipientWords("confirmed", delivery(), "unpowered")).toBe(
      "received",
    );
  });
});
