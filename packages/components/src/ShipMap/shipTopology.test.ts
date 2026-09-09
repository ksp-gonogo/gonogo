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

describe("mesh-centre offset frame", () => {
  /**
   * `bounds.center` is `Part.boundsCentroidOffset`, which KSP itself only
   * ever reads as `partTransform.rotation * boundsCentroidOffset` (two call
   * sites in `Assembly-CSharp`, and no writer anywhere). It is PART-local,
   * so it has to be carried into the vessel frame before it can be added to
   * `orgPos`.
   *
   * The motivating case, and the one the old comment named: a radial
   * decoupler mounted on the +X side of a stack, whose mesh sits 0.15 m out
   * along its own up axis. Added raw, that offset ran up the SPINE and left
   * the decoupler sunk in the stack it is holding off. Rotated, it pushes
   * the part out sideways, which is the entire reason the offset is read.
   */
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

  /**
   * Two parts carrying the IDENTICAL authored offset on different mounts
   * have to land in different places. `boundsCentroidOffset` is one value
   * serving every instance of a part, so if the offset survives into the
   * vessel frame unchanged then eight panels on a ring all displace the same
   * way, which is the shape of the original defect.
   */
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

  /**
   * The rotation is a rotation: it cannot change how far the mesh centre
   * sits from the anchor, only which way. A tilted mount with an offset that
   * is NOT up-aligned is the case where the unrecoverable roll bites, and
   * length is the invariant that still has to hold there.
   */
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

  /**
   * What the swing CANNOT do, written down so nobody reads the rotation as a
   * full one. `up` is `orgRot * Vector3.up`: it pins two of three rotational
   * degrees of freedom and says nothing about the roll ABOUT that axis.
   *
   * These two mounts are one station apart on the real `oxstat-ring` capture,
   * a 45-degree turn about the vessel Y axis (verified against the capture:
   * treating the ring as `Ry(45k)` composed with one shared tilt reproduces
   * all eight `up` vectors to 9e-9). A part-local offset lying in the plane
   * PERPENDICULAR to up therefore ought to swing 45 degrees round with it.
   * The minimal swing carries no roll, so it does not: the offset stays
   * where it was and only its up-aligned share moves.
   *
   * The offset's LENGTH is still exact, and so is its component along `up`
   * (zero here, since this offset is perpendicular). Closing the rest needs
   * the mod to put `orgRot` on the wire.
   */
  it("cannot recover the roll about up, and this is what that costs", () => {
    const center = { x: -0.033157, y: 0, z: 0 };
    const at = (up: [number, number, number]) =>
      buildShipMapPart(
        part({
          orgPos: [0, 0, 0],
          up,
          bounds: { size: { x: 1, y: 1, z: 1 }, center },
        }),
        undefined,
        undefined,
        true,
      );
    const first = at([0.27684477, 0.96091467, 0]);
    const next = at([0.19575876, 0.96091467, -0.19575885]);
    // A true 45-degree clocking would put the offset here.
    const turn = Math.PI / 4;
    const trueLat = first.lat * Math.cos(turn) + first.depth * Math.sin(turn);
    const trueDepth =
      -first.lat * Math.sin(turn) + first.depth * Math.cos(turn);
    expect(trueLat).toBeCloseTo(-0.022529, 5);
    expect(trueDepth).toBeCloseTo(0.022529, 5);
    // What the swing actually produces: barely moved off the first mount.
    expect(next.lat).toBeCloseTo(-0.032509, 5);
    expect(next.depth).toBeCloseTo(-0.000648, 5);
    // The invariants that DO survive.
    expect(Math.hypot(next.lat, next.axial, next.depth)).toBeCloseTo(
      Math.hypot(center.x, center.y, center.z),
      9,
    );
    expect(
      next.lat * 0.19575876 +
        next.axial * 0.96091467 +
        next.depth * -0.19575885,
    ).toBeCloseTo(0, 9);
  });

  /**
   * The overwhelmingly common part is axially mounted, and the identity
   * rotation must leave it exactly where it was: an engine bell hanging
   * below its attach origin stays hanging below it.
   */
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

  /**
   * A part mounted exactly upside-down: `up` is the negation of vessel up, so
   * there is no unique swing (every axis in the plane is minimal). The
   * half-turn about the vessel X axis is the convention chosen. What must
   * never happen is the naive `1 / (1 + cos)` dividing by zero and putting
   * `NaN` into an SVG coordinate, which renders nothing and reports nothing.
   */
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

  /**
   * A fixture recorded before the mod emitted `up` has no rotation to apply,
   * and neither does one whose `up` arrived as a zero vector. Both take the
   * identity: the offset comes through rather than being dropped.
   */
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
