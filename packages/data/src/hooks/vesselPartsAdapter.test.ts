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

  it("carries the part's shape key and each moved or switched mesh, as plain numbers", () => {
    const wire: VesselParts = {
      meta: { source: "test" },
      parts: [
        {
          id: "4",
          name: "landingLeg1-2",
          title: "LT-2 Landing Strut",
          position: { x: value("m", 0), y: value("m", 0), z: value("m", 0) },
          bounds: {
            size: { x: value("m", 1), y: value("m", 2), z: value("m", 1) },
          },
          shape: "landingLeg1-2",
          shapePoses: [
            {
              mesh: "leg/foot",
              shown: true,
              transform: [1, 0, 0, 0.2, 0, 1, 0, -0.5, 0, 0, 1, 0].map((n) =>
                value("1", n),
              ),
            },
            { mesh: "leg/cover", shown: false, transform: null },
            { mesh: "leg/bad", shown: true, transform: [value("1", 1)] },
          ],
          category: "Utility",
          modules: [],
          isPowerRelated: false,
          resources: {},
          moduleStates: [],
          actionBindings: [],
        },
      ],
    };

    const [part] = deriveTopologyFromVesselParts(wire).parts;

    expect(part.shape).toBe("landingLeg1-2");
    expect(part.shapePoses).toEqual([
      {
        mesh: "leg/foot",
        shown: true,
        transform: [1, 0, 0, 0.2, 0, 1, 0, -0.5, 0, 0, 1, 0],
      },
      { mesh: "leg/cover", shown: false },
      { mesh: "leg/bad", shown: true },
    ]);
  });

  describe("a tree with a part left out", () => {
    const part = (
      id: string,
      parentId?: string,
    ): VesselParts["parts"][number] => ({
      id,
      parentId,
      name: `part${id}`,
      title: `Part ${id}`,
      position: { x: value("m", 0), y: value("m", 0), z: value("m", 0) },
      bounds: {
        size: { x: value("m", 1), y: value("m", 1), z: value("m", 1) },
      },
      category: "Pods",
      modules: [],
      isPowerRelated: false,
      resources: {},
      moduleStates: [],
      actionBindings: [],
    });

    it("roots at the first part whose parent is not in the tree when the root is missing", () => {
      const wire: VesselParts = {
        meta: { source: "test" },
        parts: [part("2", "1"), part("3", "2")],
      };

      const topology = deriveTopologyFromVesselParts(wire);

      expect(topology.rootFlightId).toBe(2);
      expect(topology.parts.map((p) => p.parentFlightId)).toEqual([null, 2]);
    });

    it("keeps a parentless part as the root when an orphan comes first", () => {
      const wire: VesselParts = {
        meta: { source: "test" },
        parts: [part("3", "2"), part("1")],
      };

      const topology = deriveTopologyFromVesselParts(wire);

      expect(topology.rootFlightId).toBe(1);
      expect(topology.parts.map((p) => p.parentFlightId)).toEqual([1, null]);
    });

    it("hangs a subtree whose parent is missing from the root rather than from an id that does not exist", () => {
      const wire: VesselParts = {
        meta: { source: "test" },
        parts: [part("1"), part("3", "2"), part("4", "3")],
      };

      const topology = deriveTopologyFromVesselParts(wire);

      expect(topology.rootFlightId).toBe(1);
      expect(topology.parts.map((p) => p.parentFlightId)).toEqual([null, 1, 3]);
    });
  });
});
