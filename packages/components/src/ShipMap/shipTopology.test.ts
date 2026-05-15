import type { TopologyPart } from "@gonogo/core";
import { describe, expect, it } from "vitest";
import { buildShipMapPart, classifyPart } from "./shipTopology";

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

  it("treats edge-on parts as unrotated (no -0 atan2 flip)", () => {
    // A docking port mounted laterally has up = [0, -0, ±1] — both X
    // and Y components are zero. With useX=true the diagram projects
    // away Z, leaving (0, -0) as the 2D up vector. Math.atan2(0, -0)
    // returns π (because the sign of -0 matters), which would render
    // the port upside-down. The edge-on guard must short-circuit to
    // rotation = 0 in that case.
    const p = buildShipMapPart(
      part({
        name: "dockingPort2",
        orgPos: [0, -5, -1.22],
        up: [0, -0, -1],
      }),
      undefined,
      undefined,
      true, // useX
    );
    expect(p.rotationRad).toBe(0);
  });

  it("rotates a radially-mounted part toward its projected up", () => {
    // Side nose cone with up ≈ [+0.5, +0.87, 0] (about 30° tilt from
    // vessel up). With useX=true the 2D up is (0.5, 0.87), giving
    // atan2 ≈ 0.524 rad ≈ 30°.
    const p = buildShipMapPart(
      part({
        name: "noseCone",
        orgPos: [1.0, 0, 0],
        up: [0.5, 0.866, 0],
      }),
      undefined,
      undefined,
      true,
    );
    expect(p.rotationRad).toBeCloseTo(Math.PI / 6, 2);
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
