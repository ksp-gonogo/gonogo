import type { FleetVesselSilence } from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import { computeVesselStatus } from "./vesselStatusContribution";

const silent = (
  over: Partial<FleetVesselSilence> = {},
): FleetVesselSilence => ({
  state: "Silent",
  silenceSinceUt: 1_000,
  deadlineUt: 4_000,
  deadlineBasis: "predicted-reacquisition",
  predictedReacquisitionUt: 2_000,
  ...over,
});

describe("computeVesselStatus", () => {
  it("contributes nothing when no silence data has arrived for the vessel", () => {
    expect(computeVesselStatus("v1", undefined, 1_000)).toEqual([]);
  });

  it("contributes nothing while the vessel is nominal", () => {
    expect(computeVesselStatus("v1", { state: "Nominal" }, 1_000)).toEqual([]);
  });

  it("contributes an info entry while a silent vessel is not yet due back", () => {
    const [entry] = computeVesselStatus("v1", silent(), 1_500);
    expect(entry).toMatchObject({
      target: "v1",
      severity: "info",
      emphasis: "reckoned",
    });
    expect(entry.label).toMatch(/reacquire expected/i);
  });

  it("contributes an info entry with no countdown when silent with no prediction", () => {
    const [entry] = computeVesselStatus(
      "v1",
      silent({
        deadlineBasis: "no-occultation",
        predictedReacquisitionUt: null,
      }),
      999_999,
    );
    expect(entry).toMatchObject({ target: "v1", severity: "info" });
    expect(entry.label).toMatch(/no contact/i);
  });

  it("contributes a warning entry once the predicted emergence has passed", () => {
    const [entry] = computeVesselStatus("v1", silent(), 2_500);
    expect(entry).toMatchObject({
      target: "v1",
      severity: "warning",
      emphasis: "reckoned",
    });
    expect(entry.label).toMatch(/overdue by/i);
  });

  it("contributes a critical entry once officially lost", () => {
    const [entry] = computeVesselStatus("v1", silent({ state: "Lost" }), 2_500);
    expect(entry).toMatchObject({
      target: "v1",
      severity: "critical",
      emphasis: "reckoned",
      label: "Officially lost",
    });
  });

  it("stamps every entry's target with the vessel id it decorates", () => {
    const [entry] = computeVesselStatus(
      "vessel-xyz",
      silent({ state: "Lost" }),
      0,
    );
    expect(entry.target).toBe("vessel-xyz");
  });
});
