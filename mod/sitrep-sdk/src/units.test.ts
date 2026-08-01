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

  it("returns undefined for a field with no declared unit yet", () => {
    // Coverage is partial by design; an unannotated field must read as "not stated",
    // never as a guess and never as dimensionless.
    expect(unitOf("vessel.flight", "meta")).toBeUndefined();
    expect(unitOf("vessel.identity", "name")).toBeUndefined();
  });

  it("exposes nested payload shapes that are not Topics of their own", () => {
    // ThermalHottestPart hangs off vessel.thermal, so it is unreachable through the
    // Topic-keyed view and needs the type-keyed one.
    expect(unitOfTypeField("ThermalHottestPart", "skinMaxTemp")).toBe("K");
    expect(unitsForTopic("vessel.thermal").skinMaxTemp).toBeUndefined();
  });

  it("returns an empty object, not undefined, for an unmapped lookup", () => {
    expect(unitsForTopic("vessel.identity")).toEqual({});
    expect(unitsForType("NoSuchType")).toEqual({});
  });

  it("only ever emits tokens from the closed SitrepUnit vocabulary", () => {
    // The emitter throws on an off-catalogue token, so this asserts the generated
    // union and the generated values cannot drift apart.
    const src = readFileSync(
      fileURLToPath(new URL("./__generated__/units.ts", import.meta.url)),
      "utf8",
    );
    const union = src.slice(
      src.indexOf("export type SitrepUnit ="),
      src.indexOf("export type UnitsByField"),
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
