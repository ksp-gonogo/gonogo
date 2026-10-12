import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { derivePartResources } from "./vesselPartsAdapter";

describe("derivePartResources", () => {
  it("passes on a resource moved by a process with no readable rate", () => {
    const resources = derivePartResources({
      resources: {
        Ore: {
          amount: value("units", 0),
          maxAmount: value("units", 0),
          unratedProcess: true,
        },
      },
    });

    expect(resources.Ore).toEqual({
      amount: 0,
      maxAmount: 0,
      unratedProcess: true,
    });
  });

  it("says nothing of a process where none is marked", () => {
    const resources = derivePartResources({
      resources: {
        LiquidFuel: {
          amount: value("units", 90),
          maxAmount: value("units", 180),
        },
      },
    });

    expect(resources.LiquidFuel).toEqual({ amount: 90, maxAmount: 180 });
  });

  it("keeps a figure that could not be read as null, not zero", () => {
    const resources = derivePartResources({
      resources: { Oxidizer: { amount: null, maxAmount: null } },
    });

    expect(resources.Oxidizer).toEqual({ amount: null, maxAmount: null });
  });
});
