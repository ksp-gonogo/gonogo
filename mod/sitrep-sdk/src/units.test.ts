import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_TOPIC_UNITS } from "./__generated__/units";
import { unitOf, unitOfTypeField, unitsForTopic, unitsForType } from "./units";

/**
 * The end-to-end proof for the unit mechanism: a `[SitrepUnit(...)]` attribute on a
 * `Sitrep.Contract` property has to survive the codegen run and arrive as a value a
 * TypeScript consumer can read AT RUNTIME, not as a comment.
 *
 * Each expectation below is anchored to what the C# doc comment already stated in
 * prose, so this file doubles as the check that nobody annotated a field by guessing:
 * the units are transcriptions, not inventions.
 */
describe("generated units", () => {
  it("carries a length, a speed, a temperature and a dimensionless number", () => {
    // Four representative units, one Topic, all four straight off `vessel.flight`.
    expect(unitOf("vessel.flight", "altitudeTerrain")).toBe("m");
    expect(unitOf("vessel.flight", "surfaceSpeed")).toBe("m/s");
    // "Ambient atmospheric temperature at the vessel's position, Kelvin".
    expect(unitOf("vessel.flight", "atmosphericTemperature")).toBe("K");
    // Mach is dimensionless: the explicit "1" token, not an absent annotation.
    expect(unitOf("vessel.flight", "mach")).toBe("1");
  });

  it("distinguishes a 0..1 ratio from a bare dimensionless number", () => {
    // Both are unitless, but a ratio wants "x100 and append %" while a dimensionless
    // number wants to be shown bare. A formatter needs to tell them apart.
    expect(unitOf("vessel.thermal", "maxInternalTempRatio")).toBe("ratio");
    expect(unitOf("vessel.orbit", "ecc")).toBe("1");
  });

  it("preserves the KSP-native degrees/radians split rather than papering over it", () => {
    // VesselOrbit's own doc comment calls this inherited inconsistency deliberately
    // KEPT. Making it machine-readable is the whole point: a consumer that assumed
    // one angular unit for the whole record was previously wrong with no way to know.
    expect(unitOf("vessel.orbit", "inc")).toBe("°");
    expect(unitOf("vessel.orbit", "lan")).toBe("°");
    expect(unitOf("vessel.orbit", "argPe")).toBe("°");
    expect(unitOf("vessel.orbit", "meanAnomalyAtEpoch")).toBe("rad");
  });

  it("declares the non-quantities rather than leaving them silent", () => {
    // The rule this inverts: coverage used to be partial by design and an
    // unannotated field read as "not stated". That made absence unfalsifiable,
    // so a non-quantity now DECLARES itself and silence means someone forgot.
    // A vessel name is text; it is not a quantity and it is no longer bare.
    expect(unitOf("vessel.identity", "name")).toBe("text");
  });

  it("propagates a Vec3 field's unit to its x/y/z wire components", () => {
    // A [SitrepUnit] on a Vec3-TYPED field states the unit of the whole
    // vector; there is one canonical Vec3 shape carrying three different units
    // across the wire, so the unit cannot sit on the Vec3 type itself. Codegen
    // propagates the field-level unit onto the three scalar leaves the wire
    // actually carries (position.x / position.y / position.z), so a consumer
    // formatting a component reads the same unit it would for a plain scalar.
    expect(unitOf("vessel.orbit.truth", "position.x")).toBe("m");
    expect(unitOf("vessel.orbit.truth", "position.y")).toBe("m");
    expect(unitOf("vessel.orbit.truth", "position.z")).toBe("m");
    expect(unitOf("vessel.orbit.truth", "velocity.x")).toBe("m/s");
    expect(unitOf("vessel.orbit.truth", "velocity.y")).toBe("m/s");
    expect(unitOf("vessel.orbit.truth", "velocity.z")).toBe("m/s");
  });

  it("propagates a direction vector's dimensionless unit, not a length", () => {
    // VesselPart.Up is a unit vector: a direction, not a position. It carries
    // the explicit dimensionless "1" token so a formatter does not append "m"
    // to a component that has no length. Reached through the type-keyed view
    // because VesselPart is nested under vessel.parts, not a Topic of its own.
    expect(unitOfTypeField("VesselPart", "up.x")).toBe("1");
    expect(unitOfTypeField("VesselPart", "position.x")).toBe("m");
  });

  it("propagates a Vec3 unit on a NESTED shape no Topic names", () => {
    // PartBounds hangs off VesselPart.Bounds, so its Vec3 leaves are only
    // reachable through the type view, the same way ThermalHottestPart is.
    expect(unitOfTypeField("PartBounds", "size.x")).toBe("m");
    expect(unitOfTypeField("PartBounds", "center.z")).toBe("m");
  });

  it("still returns undefined for a structural property", () => {
    // The one legitimate absence left. A container has no dimension of its own:
    // `meta` is a PayloadMeta and is described entirely by the units on its own
    // fields, so the coverage gate exempts it BY TYPE rather than by name.
    expect(unitOf("vessel.flight", "meta")).toBeUndefined();
  });

  it("exposes nested payload shapes that are not Topics of their own", () => {
    // ThermalHottestPart hangs off vessel.thermal, so it is unreachable through the
    // Topic-keyed view and needs the type-keyed one.
    expect(unitOfTypeField("ThermalHottestPart", "skinMaxTemp")).toBe("K");
    expect(unitsForTopic("vessel.thermal").skinMaxTemp).toBeUndefined();
  });

  it("returns an empty object, not undefined, for an unmapped lookup", () => {
    // A Topic nothing has annotated yet still indexes cleanly. `vessel.identity`
    // used to be the example and is now fully declared, so this needs a name no
    // payload has: the guarantee is about the shape of a miss, not about which
    // Topics happen to be bare this week.
    expect(unitsForTopic("no.such.topic" as never)).toEqual({});
    expect(unitsForType("NoSuchType")).toEqual({});
  });

  it("only ever emits tokens from the KnownSitrepUnit vocabulary", () => {
    // The emitter throws on an off-catalogue token, so this asserts the generated
    // union and the generated values cannot drift apart.
    //
    // `SitrepUnit` itself is open, so that it can carry a unit a third-party
    // Uplink declares, and an open union can assert nothing. The thing worth
    // holding is narrower and is what this checks: everything generated FROM
    // THIS ASSEMBLY is catalogued, because everything here went through the
    // catalog check. The open arm is for symbols that never pass through here.
    const src = readFileSync(
      fileURLToPath(new URL("./__generated__/units.ts", import.meta.url)),
      "utf8",
    );
    const union = src.slice(
      src.indexOf("export type KnownSitrepUnit ="),
      src.indexOf("export type SitrepUnit ="),
    );
    const vocabulary = new Set(
      [...union.matchAll(/\| "([^"]+)"/g)].map((m) => m[1]),
    );
    expect(vocabulary.size).toBeGreaterThan(0);
    for (const fields of Object.values(GENERATED_TOPIC_UNITS)) {
      for (const unit of Object.values(fields)) {
        expect(vocabulary).toContain(unit);
      }
    }
  });
});
