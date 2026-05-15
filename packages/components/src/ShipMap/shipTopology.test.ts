import type { TopologyPart } from "@gonogo/core";
import { describe, expect, it } from "vitest";
import { classifyPart } from "./shipTopology";

function part(overrides: Partial<TopologyPart>): TopologyPart {
  return {
    flightId: 1,
    persistentId: 1,
    parentFlightId: null,
    name: "test",
    title: "Test",
    manufacturer: "",
    category: "Utility",
    inverseStage: 0,
    crewCapacity: 0,
    maxTemp: 1200,
    crashTolerance: 8,
    dryMass: 0.1,
    orgPos: [0, 0, 0],
    bounds: { size: { x: 1, y: 1, z: 1 } },
    modules: [],
    ...overrides,
  };
}

describe("classifyPart", () => {
  it("classifies cargo bays as 'other', not 'fin'", () => {
    // mk2CargoBayS in the rover-b-alone fixture has both
    // ModuleLiftingSurface (body-lift bonus) and ModuleCargoBay. The fin
    // gate has to recognise the cargo bay or a 2.5m cargo box renders
    // as a giant triangle in the diagram.
    expect(
      classifyPart(
        part({
          name: "mk2CargoBayS",
          title: "Mk2 Cargo Bay",
          category: "Payload",
          modules: [
            "ModuleLiftingSurface",
            "ModuleAnimateGeneric",
            "ModuleCargoBay",
            "ModuleCargoPart",
          ],
        }),
      ),
    ).toBe("other");
  });

  it("still classifies a real wing with ModuleLiftingSurface as 'fin'", () => {
    expect(
      classifyPart(
        part({
          name: "wingConnector",
          title: "Wing Connector",
          category: "Aero",
          modules: ["ModuleLiftingSurface"],
        }),
      ),
    ).toBe("fin");
  });

  it("prefers engine over fin when both modules are present", () => {
    // Sanity check that the cargo-bay gate didn't reorder anything that
    // mattered. Real KSP engines don't usually have a lifting surface
    // but the order-of-precedence chain is load-bearing — keep this.
    expect(
      classifyPart(
        part({
          modules: ["ModuleEngines", "ModuleLiftingSurface"],
        }),
      ),
    ).toBe("engine");
  });
});
