import { type VesselParts, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  derivePartResources,
  deriveTopologyFromVesselParts,
} from "./vesselPartsAdapter";

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

describe("deriveTopologyFromVesselParts", () => {
  const axis = (x: number, y: number, z: number) => ({
    x: value("1", x),
    y: value("1", y),
    z: value("1", z),
  });

  it("carries the part's up and forward axes, which together fix its rotation", () => {
    const wire: VesselParts = {
      meta: { source: "test" },
      parts: [
        {
          id: "7",
          name: "winglet",
          title: "AV-R8 Winglet",
          position: {
            x: value("m", -1.19),
            y: value("m", 0),
            z: value("m", -0.37),
          },
          up: axis(0, 1, 0),
          forward: axis(-0.259, 0, 0.966),
          bounds: {
            size: {
              x: value("m", 1.497),
              y: value("m", 2.11),
              z: value("m", 0.097),
            },
            center: {
              x: value("m", -0.119),
              y: value("m", 0.227),
              z: value("m", 0.007),
            },
          },
          category: "Aero",
          modules: [],
          isPowerRelated: false,
          resources: {},
          moduleStates: [],
          actionBindings: [],
        },
      ],
    };

    const [part] = deriveTopologyFromVesselParts(wire).parts;

    expect(part.up).toEqual([0, 1, 0]);
    expect(part.forward).toEqual([-0.259, 0, 0.966]);
    expect(part.bounds.size).toEqual({ x: 1.497, y: 2.11, z: 0.097 });
    expect(part.bounds.center).toEqual({ x: -0.119, y: 0.227, z: 0.007 });
  });
});
