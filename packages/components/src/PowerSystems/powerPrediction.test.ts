import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { projectCharge } from "./powerPrediction";

const base = {
  stored: 31.2,
  capacity: 140,
  rate: -0.04,
  asOfUt: value("ut", 1000),
};

describe("projectCharge", () => {
  it("carries the stored charge down at the held rate and counts to empty from now", () => {
    const p = projectCharge({ ...base, nowUt: value("ut", 1060) });
    expect(p?.stored).toBeCloseTo(31.2 - 0.04 * 60);
    expect(p?.secondsToEmpty).toBeCloseTo((31.2 - 2.4) / 0.04);
    expect(p?.emptySinceUt).toBeUndefined();
  });

  it("says when the model crossed zero once now is past it, and holds the level at zero", () => {
    const p = projectCharge({
      ...base,
      nowUt: value("ut", 1000 + 31.2 / 0.04 + 100),
    });
    expect(p?.stored).toBe(0);
    expect(p?.secondsToEmpty).toBeUndefined();
    expect(p?.emptySinceUt).toBeCloseTo(1000 + 31.2 / 0.04);
  });

  it("gives no time to empty while charging, and stops at capacity", () => {
    const p = projectCharge({ ...base, rate: 1, nowUt: value("ut", 1500) });
    expect(p?.stored).toBe(140);
    expect(p?.secondsToEmpty).toBeUndefined();
    expect(p?.emptySinceUt).toBeUndefined();
  });

  it("does not move the model backwards when now is before the report", () => {
    expect(
      projectCharge({ ...base, nowUt: value("ut", 900) })?.stored,
    ).toBeCloseTo(31.2);
  });

  it.each([
    ["stored", { stored: undefined }],
    ["rate", { rate: undefined }],
    ["nowUt", { nowUt: undefined }],
    ["a non-finite rate", { rate: Number.NaN }],
  ])("declines without %s", (_name, patch) => {
    expect(
      projectCharge({ ...base, nowUt: value("ut", 1060), ...patch }),
    ).toBeUndefined();
  });
});
