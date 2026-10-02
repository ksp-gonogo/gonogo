import { describe, expect, it } from "vitest";
import { describeSendStatus, sendStatusFor } from "./commcastSendStatus";

describe("describeSendStatus", () => {
  it("writes the contact and the signal delay on one line and the arrival on the next", () => {
    expect(
      describeSendStatus({
        contact: { kind: "back-in", seconds: 180 },
        signalDelaySeconds: 480,
        arrival: "expected",
      }),
    ).toBe("No contact, back in 3min · 8min signal delay\nExpected to arrive");
    expect(
      describeSendStatus({
        contact: { kind: "loss-in", seconds: 300 },
        signalDelaySeconds: 480,
        arrival: "likely-lost",
      }),
    ).toBe("LOS in 5min · 8min signal delay\nLikely lost");
  });

  it("says there is no signal path rather than quoting a zero delay", () => {
    expect(
      describeSendStatus({ contact: { kind: "none" }, arrival: "likely-lost" }),
    ).toBe("No contact · no signal path\nLikely lost");
  });
});

describe("sendStatusFor", () => {
  it("has nothing to say about an addressee in contact, since nothing predicts a loss", () => {
    expect(sendStatusFor([])).toBeUndefined();
  });

  it("calls an addressee off the roster out of contact with no return, likely lost", () => {
    expect(sendStatusFor(["Woomera Range"])).toEqual({
      contact: { kind: "none" },
      arrival: "likely-lost",
    });
  });
});
