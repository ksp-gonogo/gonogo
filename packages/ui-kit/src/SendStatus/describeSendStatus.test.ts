import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { describeSendStatus } from "./describeSendStatus";

describe("describeSendStatus", () => {
  it("writes the contact and the signal delay on one line and the arrival on the next", () => {
    expect(
      describeSendStatus({
        contact: { kind: "back-in", seconds: value("s", 180) },
        signalDelay: value("s", 480),
        arrival: "expected",
      }),
    ).toBe("No contact, back in 3min · 8min signal delay\nExpected to arrive");
    expect(
      describeSendStatus({
        contact: { kind: "loss-in", seconds: value("s", 300) },
        signalDelay: value("s", 480),
        arrival: "likely-lost",
      }),
    ).toBe("LOS in 5min · 8min signal delay\nLikely lost");
  });

  it("says there is no signal path rather than quoting a zero delay", () => {
    expect(
      describeSendStatus({ contact: { kind: "none" }, arrival: "likely-lost" }),
    ).toBe("No contact · no signal path\nLikely lost");
  });

  it("says a live route sends now and a held one waits and arrives at stated times", () => {
    expect(
      describeSendStatus({
        contact: { kind: "in-contact" },
        signalDelay: value("s", 480),
        arrival: "expected",
        sends: "now",
      }),
    ).toBe("In contact · 8min signal delay\nSends now");
    const held = describeSendStatus({
      contact: { kind: "back-in", seconds: value("s", 180) },
      signalDelay: value("s", 1000),
      arrival: "expected",
      sends: "held",
      heldUntilUt: value("ut", 1180),
      arrivesUt: value("ut", 2000),
    });
    expect(held).toMatch(
      /^No contact, back in 3min · 16min 40s signal delay\nHeld until .+, arrives .+$/,
    );
  });
});
