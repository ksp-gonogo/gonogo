import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { type CrashReportOfEnding, crashEndingOf } from "./useCrashEnding";

const report = (over: Partial<CrashReportOfEnding> = {}) =>
  ({
    vesselId: "doomed",
    ut: value("ut", 1000),
    ...over,
  }) as CrashReportOfEnding;

describe("the crash a flight ended in", () => {
  it("is the crash on record while the vessel that crashed is the one reporting, or none is", () => {
    const crash = report();
    expect(
      crashEndingOf({ recent: true, report: crash, vesselId: "doomed" }),
    ).toBe(crash);
    expect(
      crashEndingOf({ recent: true, report: crash, vesselId: undefined }),
    ).toBe(crash);
  });

  it("is nothing without a crash on record", () => {
    expect(
      crashEndingOf({ recent: false, report: report(), vesselId: undefined }),
    ).toBeUndefined();
    expect(
      crashEndingOf({ recent: true, report: undefined, vesselId: undefined }),
    ).toBeUndefined();
  });

  it("is over once another vessel is the one flying: a new flight does not sit under the old crash", () => {
    expect(
      crashEndingOf({
        recent: true,
        report: report(),
        vesselId: "a-new-craft",
      }),
    ).toBeUndefined();
  });

  it("is over once the flight clock reads earlier than the crash, as it does after a revert to the same craft", () => {
    expect(
      crashEndingOf({
        recent: true,
        report: report(),
        vesselId: "doomed",
        flightAt: value("ut", 400),
      }),
    ).toBeUndefined();
    expect(
      crashEndingOf({
        recent: true,
        report: report(),
        vesselId: "doomed",
        flightAt: value("ut", 1010),
      }),
    ).toBeDefined();
  });
});
