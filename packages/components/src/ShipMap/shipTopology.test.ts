import type { TopologyPart } from "@ksp-gonogo/core";
import { KspPartCategory } from "@ksp-gonogo/sitrep-sdk";
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
  /**
   * The category branch reads KSP's ORDINAL, not its name.
   *
   * It switched on the name until 2026-08-21, and the failure was quiet rather
   * than loud: a renamed `PartCategories` member sent every part of that
   * category through to `classifyByName` underneath, so an engine was drawn as
   * whatever its title happened to match. Falling through to a heuristic is the
   * right behaviour for a category with no glyph; for `Engine` it is not.
   *
   * The part below carries a category name this build has never seen and a
   * title with no engine word in it, so only the ordinal can classify it.
   */
  it("classifies from the category ordinal, not the category name", () => {
    expect(
      classifyPart(
        part({
          name: "mysteryThruster",
          title: "Mystery Unit",
          category: "Propulsive",
          categoryOrdinal: KspPartCategory.Engine,
        }),
      ),
    ).toBe("engine");
  });

  /**
   * With no ordinal to read, the name/title heuristic underneath still runs.
   * A fixture captured before the mod emitted the ordinal has to stay readable,
   * and an unclassifiable part is not an error.
   */
  it("falls through to the name heuristic when no ordinal arrived", () => {
    expect(
      classifyPart(
        part({
          name: "liquidEngine",
          title: "Liquid Fuel Engine",
          category: "Engine",
          categoryOrdinal: null,
        }),
      ),
    ).toBe("engine");
  });

  /**
   * `PartCategories.none` is `-1`, a declared member rather than an absence, and
   * this diagram has no glyph for it. It must reach the heuristic like any other
   * unglyphed category, not be mistaken for "no ordinal sent" - the two would
   * behave the same here, but only one of them is a missing read.
   */
  it("treats PartCategories.none as a category with no glyph", () => {
    expect(
      classifyPart(
        part({
          name: "strutConnector",
          title: "Strut Connector",
          category: "none",
          categoryOrdinal: KspPartCategory.none,
        }),
      ),
    ).toBe("other");
  });

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
    // A docking port mounted laterally has up = [0, -0, ±1], both X
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
    // but the order-of-precedence chain is load-bearing; keep this.
    expect(
      classifyPart(
        part({
          modules: ["ModuleEngines", "ModuleLiftingSurface"],
        }),
      ),
    ).toBe("engine");
  });
});
