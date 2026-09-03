import { describe, expect, it } from "vitest";
import {
  PrincipiaWriteOutcome,
  PrincipiaWriteRefusal,
} from "./__generated__/contract";
import type { PrincipiaPlanWriteReply } from "./planWrite";
import {
  nothingWasWritten,
  planWriteReceipt,
  planWriteRefusalLine,
} from "./planWrite";

/** A write's answer as the wire carries it: the envelope, receipt on `payload`. */
function reply(payload?: Record<string, unknown>): PrincipiaPlanWriteReply {
  return { success: true, errorCode: 0, payload };
}

/** The receipt inside a reply that is meant to carry one, or a failed test. */
function receiptOf(payload: Record<string, unknown>) {
  const receipt = planWriteReceipt(reply(payload));
  if (receipt === null) throw new Error("the reply carried no receipt");
  return receipt;
}

const WRITTEN = {
  requestId: "replace-0",
  outcome: PrincipiaWriteOutcome.Written,
  refusal: PrincipiaWriteRefusal.NotRefused,
};

describe("planWriteReceipt", () => {
  /**
   * The bug this file exists for.
   *
   * Both write surfaces cast the ENVELOPE to a receipt, so `outcome`, `refusal`
   * and `replayed` were read off a `CommandResult` that carries none of them.
   * They came back `undefined` on every plan write ever made, which is the one
   * value that reads as "fine" at each of the three call sites.
   */
  it("reads the receipt out of the envelope, not the envelope itself", () => {
    const receipt = planWriteReceipt(reply({ ...WRITTEN, replayed: true }));

    expect(receipt?.replayed).toBe(true);
    expect(receipt?.outcome).toBe(PrincipiaWriteOutcome.Written);
  });

  it("reports no receipt for a reply that carried none", () => {
    expect(planWriteReceipt(reply())).toBeNull();
  });

  /**
   * `outcome` and `refusal` are the receipt's two required fields and both
   * enums make zero the CLOSED answer, so a payload missing them cannot be
   * defaulted: zero would invent a refusal nobody issued.
   */
  it("reports no receipt for a payload that is not one", () => {
    expect(planWriteReceipt(reply({ requestId: "replace-0" }))).toBeNull();
  });
});

describe("nothingWasWritten", () => {
  it("says nothing landed when the mod answered from its own store", () => {
    expect(
      nothingWasWritten(
        planWriteReceipt(reply({ ...WRITTEN, replayed: true })),
      ),
    ).toBe(true);
  });

  it("says nothing landed when the receipt reports an outcome that is not written", () => {
    const receipt = planWriteReceipt(
      reply({
        outcome: PrincipiaWriteOutcome.Rejected,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );

    expect(nothingWasWritten(receipt)).toBe(true);
  });

  it("says a fresh write landed", () => {
    expect(nothingWasWritten(planWriteReceipt(reply(WRITTEN)))).toBe(false);
  });

  /** A reply with no receipt is not evidence of a no-op. */
  it("says nothing about a reply that carried no receipt", () => {
    expect(nothingWasWritten(null)).toBe(false);
  });
});

describe("planWriteRefusalLine", () => {
  it("names the outcome and the guard in the mod's own vocabulary", () => {
    const receipt = receiptOf({
      outcome: PrincipiaWriteOutcome.Refused,
      refusal: PrincipiaWriteRefusal.IgnitionInPast,
    });

    expect(planWriteRefusalLine(receipt)).toBe("Refused / IgnitionInPast");
  });

  it("passes the producer's own sentence through beside the codes", () => {
    const receipt = receiptOf({
      outcome: PrincipiaWriteOutcome.Rejected,
      refusal: PrincipiaWriteRefusal.NotRefused,
      refusalDetail: "the plan ends before the last coast",
    });

    expect(planWriteRefusalLine(receipt)).toBe(
      "Rejected / NotRefused: the plan ends before the last coast",
    );
  });

  it("has nothing to say about a write that landed", () => {
    expect(planWriteRefusalLine(receiptOf(WRITTEN))).toBeNull();
  });
});
