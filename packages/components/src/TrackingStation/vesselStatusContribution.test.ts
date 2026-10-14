import { CatalogContact, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  computeVesselStatus,
  type VesselContactEntry,
} from "./vesselStatusContribution";

const silent = (
  over: Partial<VesselContactEntry> = {},
): VesselContactEntry => ({
  contact: CatalogContact.Silent,
  expectedReturnUt: value("ut", 2_000),
  overdueAfterUt: value("ut", 2_000),
  ...over,
});

describe("computeVesselStatus", () => {
  it("contributes nothing when the vessel has no catalog entry", () => {
    expect(computeVesselStatus("v1", undefined, 1_000)).toEqual([]);
  });

  it("contributes nothing while the centre is in contact", () => {
    expect(
      computeVesselStatus("v1", { contact: CatalogContact.InContact }, 1_000),
    ).toEqual([]);
  });

  it("contributes an info entry while a silent vessel is not yet due back", () => {
    const [entry] = computeVesselStatus("v1", silent(), 1_500);
    expect(entry).toMatchObject({
      target: "v1",
      tone: "info",
      emphasis: "reckoned",
    });
    expect(entry.label).toBe("Reacquire expected in ~8min 20s");
  });

  it("counts a reacquisition down on the GAME ladder, where a day is six hours", () => {
    // 43,200 s is two 6h KSP days, so "12h" would mean the wall-clock ladder.
    const [entry] = computeVesselStatus(
      "v1",
      silent({
        expectedReturnUt: value("ut", 44_200),
        overdueAfterUt: value("ut", 44_200),
      }),
      1_000,
    );
    expect(entry.label).toBe("Reacquire expected in ~2d");
  });

  it("contributes an info entry with no countdown when silent with no expected return", () => {
    const [entry] = computeVesselStatus(
      "v1",
      silent({ expectedReturnUt: null, overdueAfterUt: null }),
      999_999,
    );
    expect(entry).toMatchObject({ target: "v1", tone: "info" });
    expect(entry.label).toMatch(/no contact/i);
  });

  it("contributes a warning entry once the expected return has passed", () => {
    const [entry] = computeVesselStatus("v1", silent(), 2_500);
    expect(entry).toMatchObject({
      target: "v1",
      tone: "warn",
      emphasis: "reckoned",
    });
    expect(entry.label).toBe("Overdue by 8min 20s");
  });

  it("contributes a critical entry once home's declaration of loss has arrived", () => {
    const [entry] = computeVesselStatus(
      "v1",
      silent({ contact: CatalogContact.Lost }),
      2_500,
    );
    expect(entry).toMatchObject({
      target: "v1",
      tone: "nogo",
      emphasis: "reckoned",
      label: "Officially lost",
    });
  });

  it("stamps every entry's target with the vessel id it decorates", () => {
    const [entry] = computeVesselStatus(
      "vessel-xyz",
      silent({ contact: CatalogContact.Lost }),
      0,
    );
    expect(entry.target).toBe("vessel-xyz");
  });
});
