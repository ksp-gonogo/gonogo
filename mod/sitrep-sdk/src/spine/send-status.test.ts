import { describe, expect, it } from "vitest";
import { value } from "../unit-system/value";
import { sendStatusFromRoutes } from "./send-status";

describe("sendStatusFromRoutes", () => {
  const ut = (n: number) => value("ut", n);
  const base = {
    from: "ground:ksc",
    to: "vessel:probe",
    sentUt: ut(1_000),
  };

  it("sends at once on a live route and quotes its signal delay", () => {
    const status = sendStatusFromRoutes(
      [{ ...base, arrivalUt: ut(1_480), live: true, holds: [] }],
      1_000,
    );
    expect(status).toEqual({
      contact: { kind: "in-contact" },
      signalDelay: value("s", 480),
      arrival: "expected",
      sends: "now",
      arrivesUt: ut(1_480),
    });
  });

  it("holds for the first wait still ahead and says when the order arrives", () => {
    const status = sendStatusFromRoutes(
      [
        {
          ...base,
          arrivalUt: ut(2_000),
          live: false,
          holds: [
            { at: "ground:ksc", arriveUt: ut(1_000), departUt: ut(1_180) },
          ],
        },
      ],
      1_000,
    );
    expect(status).toEqual({
      contact: { kind: "back-in", seconds: value("s", 180) },
      signalDelay: value("s", 1_000),
      arrival: "expected",
      sends: "held",
      heldUntilUt: ut(1_180),
      arrivesUt: ut(2_000),
    });
  });

  it("says there is no route, never a zero delay, when the plan predicts no arrival", () => {
    expect(
      sendStatusFromRoutes([{ ...base, live: false, holds: [] }], 1_000),
    ).toEqual({ contact: { kind: "none" }, arrival: "likely-lost" });
  });

  it("knows nothing without a row for the sending centre or from a prediction already past", () => {
    expect(sendStatusFromRoutes([], 1_000)).toBeUndefined();
    expect(sendStatusFromRoutes(null, 1_000)).toBeUndefined();
    expect(
      sendStatusFromRoutes(
        [{ ...base, arrivalUt: ut(1_480), live: true, holds: [] }],
        1_000,
        "ground:other",
      ),
    ).toBeUndefined();
    expect(
      sendStatusFromRoutes(
        [{ ...base, arrivalUt: ut(1_480), live: true, holds: [] }],
        2_000,
      ),
    ).toBeUndefined();
  });
});
