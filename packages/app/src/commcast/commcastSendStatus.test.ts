import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  describeSendStatus,
  nextContactUt,
  type PlannedContact,
  sendStatusFor,
} from "./commcastSendStatus";

describe("describeSendStatus", () => {
  it("writes the contact and the signal delay on one line and the arrival on the next", () => {
    expect(
      describeSendStatus({
        contact: { kind: "back-in", seconds: value("s", 180) },
        signalDelaySeconds: 480,
        arrival: "expected",
      }),
    ).toBe("No contact, back in 3min · 8min signal delay\nExpected to arrive");
    expect(
      describeSendStatus({
        contact: { kind: "loss-in", seconds: value("s", 300) },
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
  it("has nothing to say about an addressee in contact", () => {
    expect(sendStatusFor([])).toBeUndefined();
  });

  it("calls an addressee off the roster out of contact with no return, likely lost", () => {
    expect(sendStatusFor(["Woomera Range"])).toEqual({
      contact: { kind: "none" },
      arrival: "likely-lost",
    });
  });

  it("says when the plan has the addressee back, and still calls the words likely lost", () => {
    const back = value("s", 2280);
    expect(sendStatusFor(["Jeb's Lander"], back)).toEqual({
      contact: { kind: "back-in", seconds: back },
      arrival: "likely-lost",
    });
  });
});

describe("nextContactUt", () => {
  const ut = (n: number) => value("ut", n);
  const plan: PlannedContact[] = [
    {
      a: "ground:ksc",
      b: "vessel:probe",
      horizonUt: ut(20_000),
      windows: [
        { closeUt: ut(1_000) },
        { openUt: ut(3_280), closeUt: ut(4_000) },
        { openUt: ut(9_000) },
      ],
    },
  ];

  it("finds the next window to open, whichever end the pair was planned from", () => {
    expect(nextContactUt(plan, "ground:ksc", "vessel:probe", 1_000)).toEqual(
      ut(3_280),
    );
    expect(nextContactUt(plan, "vessel:probe", "ground:ksc", 5_000)).toEqual(
      ut(9_000),
    );
  });

  it("claims no return while the plan predicts contact now, since the roster has just said otherwise", () => {
    expect(
      nextContactUt(plan, "ground:ksc", "vessel:probe", 500),
    ).toBeUndefined();
    expect(
      nextContactUt(plan, "ground:ksc", "vessel:probe", 9_500),
    ).toBeUndefined();
  });

  it("claims no return for a pair the plan does not cover or one with no window left before its horizon", () => {
    expect(
      nextContactUt(plan, "ground:ksc", "vessel:other", 1_000),
    ).toBeUndefined();
    const closed: PlannedContact[] = [
      {
        a: "ground:ksc",
        b: "vessel:probe",
        horizonUt: ut(20_000),
        windows: [{ closeUt: ut(1_000) }],
      },
    ];
    expect(
      nextContactUt(closed, "ground:ksc", "vessel:probe", 2_000),
    ).toBeUndefined();
  });
});
