import type { TopologyPart } from "@ksp-gonogo/core";
import { KspPartCategory } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { classifyPart } from "./classifyPart";
import { buildShipMapPart } from "./shipTopology";

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
  // A category name this build has never seen and a title with no engine word: only the ordinal can classify it.
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

  // A fixture from before the ordinal existed stays readable, and an unclassifiable part is not an error.
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

  // `PartCategories.none` is `-1`, a declared member with no glyph, not a missing ordinal.
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
    // mk2CargoBayS has both ModuleLiftingSurface and ModuleCargoBay; the fin gate must recognise the bay.
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
    // up = [0, -0, 1] projects to (0, -0), where Math.atan2 returns pi on the sign of -0; the edge-on guard must give 0.
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
    // up of about [0.5, 0.87, 0] is a 30 degree tilt: atan2 of about 0.524 rad.
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
    // The order-of-precedence chain is load-bearing.
    expect(
      classifyPart(
        part({
          modules: ["ModuleEngines", "ModuleLiftingSurface"],
        }),
      ),
    ).toBe("engine");
  });
});

describe("mesh-centre offset frame", () => {
  // `bounds.center` is part-local, so a radial decoupler's up-axis offset has to push it out sideways, not up the spine.
  it("pushes a radially-mounted part out along its mount, not up the spine", () => {
    const p = buildShipMapPart(
      part({
        name: "radialDecoupler",
        orgPos: [1.25, -0.4, 0],
        up: [1, 0, 0],
        bounds: {
          size: { x: 0.3, y: 0.3, z: 0.3 },
          center: { x: 0, y: 0.15, z: 0 },
        },
      }),
      undefined,
      undefined,
      true, // useX
    );
    expect(p.lat).toBeCloseTo(1.4, 9);
    expect(p.axial).toBeCloseTo(-0.4, 9);
    expect(p.depth).toBeCloseTo(0, 9);
  });

  // One authored offset shared by every instance must land differently on different mounts.
  it("sends one authored offset to different places on different mounts", () => {
    const mount = (up: [number, number, number]) =>
      buildShipMapPart(
        part({
          name: "solarPanels5",
          orgPos: [0, 0, 0],
          up,
          bounds: {
            size: { x: 0.35, y: 0.47, z: 0.07 },
            center: { x: 0, y: 0.0332, z: 0 },
          },
        }),
        undefined,
        undefined,
        true,
      );
    const west = mount([-1, 0, 0]);
    const east = mount([1, 0, 0]);
    expect(west.lat).toBeCloseTo(-0.0332, 9);
    expect(east.lat).toBeCloseTo(0.0332, 9);
  });

  // A rotation preserves length, which still has to hold where the unrecoverable roll bites.
  it("preserves the offset's length on a tilted mount", () => {
    const center = { x: 0.02, y: 0.05, z: -0.01 };
    const p = buildShipMapPart(
      part({
        name: "tilted",
        orgPos: [0, 0, 0],
        up: [0.27684477, 0.96091467, 0],
        bounds: { size: { x: 1, y: 1, z: 1 }, center },
      }),
      undefined,
      undefined,
      true,
    );
    expect(Math.hypot(p.lat, p.axial, p.depth)).toBeCloseTo(
      Math.hypot(center.x, center.y, center.z),
      9,
    );
  });

  // Two mounts a 45 degree turn about vessel Y apart share an up axis; only forward tells them apart.
  it("turns the offset with the roll about up that forward carries", () => {
    const center = { x: -0.033157, y: 0, z: 0 };
    const at = (forward: [number, number, number]) =>
      buildShipMapPart(
        part({
          orgPos: [0, 0, 0],
          up: [0, 1, 0],
          forward,
          bounds: { size: { x: 1, y: 1, z: 1 }, center },
        }),
        undefined,
        undefined,
        true,
      );
    const first = at([0, 0, 1]);
    const turned = at([Math.SQRT1_2, 0, Math.SQRT1_2]);
    expect(first.lat).toBeCloseTo(-0.033157, 9);
    expect(first.depth).toBeCloseTo(0, 9);
    expect(turned.lat).toBeCloseTo(-0.033157 * Math.SQRT1_2, 9);
    expect(turned.depth).toBeCloseTo(0.033157 * Math.SQRT1_2, 9);
  });

  // The identity rotation leaves an axially-mounted part exactly where it was.
  it("leaves an axially-mounted part's centre alone", () => {
    const p = buildShipMapPart(
      part({
        name: "liquidEngine3.v2",
        orgPos: [0, -2.5, 0],
        up: [0, 1, 0],
        bounds: {
          size: { x: 1, y: 1, z: 1 },
          center: { x: 0, y: -0.40283102, z: 0 },
        },
      }),
      undefined,
      undefined,
      true,
    );
    expect(p.lat).toBeCloseTo(0, 9);
    expect(p.axial).toBeCloseTo(-2.90283102, 9);
  });

  // Exactly inverted has no unique swing; the naive `1 / (1 + cos)` would put `NaN` into an SVG coordinate.
  it("survives a fully inverted part without emitting NaN", () => {
    const p = buildShipMapPart(
      part({
        name: "inverted",
        orgPos: [0, 3, 0],
        up: [0, -1, 0],
        bounds: {
          size: { x: 1, y: 1, z: 1 },
          center: { x: 0.2, y: 0.5, z: 0.1 },
        },
      }),
      undefined,
      undefined,
      true,
    );
    expect(Number.isFinite(p.lat)).toBe(true);
    expect(Number.isFinite(p.axial)).toBe(true);
    expect(Number.isFinite(p.depth)).toBe(true);
    expect(p.axial).toBeCloseTo(2.5, 9);
  });

  // No `up`, or a zero one, is the identity: the offset comes through rather than being dropped.
  it("treats a missing up vector as no rotation", () => {
    const p = buildShipMapPart(
      part({
        name: "noUp",
        orgPos: [1, 2, 3],
        bounds: {
          size: { x: 1, y: 1, z: 1 },
          center: { x: 0.1, y: 0.2, z: 0.3 },
        },
      }),
      undefined,
      undefined,
      true,
    );
    expect(p.lat).toBeCloseTo(1.1, 9);
    expect(p.axial).toBeCloseTo(2.2, 9);
    expect(p.depth).toBeCloseTo(3.3, 9);
  });
});

describe("drawn extent", () => {
  // An upright part's box is its mesh box seen side on.
  it("draws an upright part at its own width and height", () => {
    const p = buildShipMapPart(
      part({ bounds: { size: { x: 1.25, y: 0.68, z: 1.1 } } }),
      undefined,
      undefined,
      true,
    );
    expect(p.latHalfExtent).toBeCloseTo(0.625, 9);
    expect(p.axialHalfExtent).toBeCloseTo(0.34, 9);
  });

  // A thin plate turned 60 degrees about up shows its span foreshortened and its thickness widened.
  it("foreshortens a plate by its turn about up", () => {
    const turn = Math.PI / 3;
    const p = buildShipMapPart(
      part({
        up: [0, 1, 0],
        forward: [Math.sin(turn), 0, Math.cos(turn)],
        bounds: { size: { x: 1.5, y: 2, z: 0.1 } },
      }),
      undefined,
      undefined,
      true,
    );
    expect(p.latHalfExtent).toBeCloseTo(
      0.75 * Math.cos(turn) + 0.05 * Math.sin(turn),
      9,
    );
    expect(p.axialHalfExtent).toBeCloseTo(1, 9);
    expect(p.rotationRad).toBe(0);
  });

  // A part lying on its side is drawn upright and turned, so its height still runs along its own up axis.
  it("keeps a part's height along its up axis when it lies on its side", () => {
    const p = buildShipMapPart(
      part({
        up: [1, 0, 0],
        forward: [0, 0, 1],
        bounds: { size: { x: 0.2, y: 0.8, z: 0.3 } },
      }),
      undefined,
      undefined,
      true,
    );
    expect(p.rotationRad).toBeCloseTo(Math.PI / 2, 9);
    expect(p.axialHalfExtent).toBeCloseTo(0.4, 9);
    expect(p.latHalfExtent).toBeCloseTo(0.1, 9);
  });
});
