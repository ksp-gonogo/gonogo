import { describe, expect, it } from "vitest";
import { value } from "../unit-system/value";
import { readUplinkActionReply } from "./held-command-actions";

describe("readUplinkActionReply", () => {
  it("reads a cancel's coverage and a send again's copy", () => {
    const cancel = readUplinkActionReply({
      success: true,
      payload: {
        throughSeq: value("count", 5),
        id: "",
        expiresAtUt: value("ut", 3700),
      },
    });
    expect(cancel.throughSeq?.magnitude).toBe(5);
    expect(cancel.id).toBeUndefined();
    expect(cancel.expiresAtUt?.magnitude).toBe(3700);

    expect(
      readUplinkActionReply({ success: true, payload: { id: "r9" } }).id,
    ).toBe("r9");
  });

  it("carries a refusal's reason", () => {
    expect(
      readUplinkActionReply({ success: false, reason: "another game" }),
    ).toEqual({
      refusal: "another game",
    });
    expect(readUplinkActionReply(undefined)).toEqual({ refusal: "no answer" });
  });
});
