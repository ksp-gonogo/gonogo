import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The "resolves to a core gonogo Value type" half of the uplink-types-out-of-core
// plan's Unit guard: a wire-visible Value<"..."> / Vec3Of<"..."> in
// this Uplink's OWN generated contract must still resolve to the core
// unit-system module (@ksp-gonogo/sitrep-sdk), never a locally hand-rolled
// Value type. See KerbalismRtConfig.Configure's `valueImportFrom` argument,
// which is the mechanism this test verifies actually took effect in the
// emitted file, not just in the C# call site.
//
// NOT vacuous: forty-seven properties across the fifteen types retype (the
// codegen run prints that count), and none of the fifteen is an inbound-only
// "...Args" for ApplyUnitValueTypes to skip.

const generatedContractPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "__generated__/contract.ts",
);

const source = () => readFileSync(generatedContractPath, "utf8");

describe("generated contract.ts: Value/Vec3Of usage resolves to core", () => {
  it("imports Value/Vec3Of from @ksp-gonogo/sitrep-sdk whenever either is used", () => {
    const src = source();
    const usesValueOrVec3Of = /\b(Value|Vec3Of)</.test(
      src.replace(/^import.*$/m, ""), // strip the import line itself before checking USAGE
    );

    expect(usesValueOrVec3Of).toBe(true);
    expect(src).toMatch(
      /import\s*\{\s*Value,\s*Vec3Of\s*\}\s*from\s*['"]@ksp-gonogo\/sitrep-sdk['"]/,
    );
  });

  // The nesting is what makes this relocation the deepest yet, and it is the
  // thing a regenerated contract could quietly flatten. If a nested type stops
  // being referenced from its parent, topics.test.ts's nested-decode assertions
  // go VACUOUS rather than red, so pin the shape here.
  it("keeps every nesting the nested-hydration proofs depend on", () => {
    const src = source();

    // kerbalism.spaceweather -> per-star / per-storm
    expect(src).toMatch(/stars\?:\s*KerbalismStarInfo\[\];/);
    expect(src).toMatch(/storms\?:\s*KerbalismStormEntry\[\];/);
    // kerbalism.crew -> per-kerbal survival rule (the dose)
    expect(src).toMatch(/rules\?:\s*KerbalismCrewRule\[\];/);
    // kerbalism.lifesupport -> habitat / processes / greenhouses
    expect(src).toMatch(/habitat\?:\s*KerbalismHabitat;/);
    expect(src).toMatch(/processes\?:\s*KerbalismProcessEntry\[\];/);
    expect(src).toMatch(/greenhouses\?:\s*KerbalismGreenhouseEntry\[\];/);
    // kerbalism.profile -> the resource definitions map, plus rules/processes
    expect(src).toMatch(
      /resources\?:\s*\{\s*\[key:\s*string\]:\s*KerbalismResourceDef\s*\};/,
    );
    expect(src).toMatch(/rules\?:\s*KerbalismRuleDef\[\];/);
    expect(src).toMatch(/processes\?:\s*KerbalismProcessDef\[\];/);
  });

  it("keeps the deepest declared quantities typed as Values", () => {
    const src = source();

    // The per-kerbal dose and its two death-clock constants: the deepest
    // quantities on the crew surface, and what topics.test.ts asserts decodes.
    expect(src).toMatch(/value\?:\s*Value<"units">;/);
    expect(src).toMatch(/degenPerSec\?:\s*Value<"units\/s">;/);
    // A star's distance, reached only through spaceweather's `stars` array.
    expect(src).toMatch(/distance\?:\s*Value<"m">;/);
  });

  // A Vec3 on a NESTED type, which no earlier relocated slice carried at all.
  // The unit is declared on KerbalismStarInfo.Direction and has to survive two
  // hops of shape resolution before fanning out to the vector's three leaves.
  it("keeps the nested Vec3 typed as Vec3Of, not a bare Vec3", () => {
    expect(source()).toMatch(/direction\?:\s*Vec3Of<"1">;/);
  });

  // The name-keyed unit map. This form exists nowhere else in the whole
  // contract any more: the SDK's own generated output lost its last example
  // when these types relocated, which is why the assertion that used to live in
  // mod/sitrep-sdk/src/generated.test.ts now lives here. The unit belongs to
  // each VALUE and the key is a resource/rule NAME, so nothing camel-cases it.
  it("keeps the unit inside the map for a name-keyed set of readings", () => {
    const src = source();

    expect(src).toMatch(
      /rates\?:\s*\{\s*\[key:\s*string\]:\s*Value<"units\/s">\s*\};/,
    );
    expect(src).toMatch(
      /ruleEnvModifiers\?:\s*\{\s*\[key:\s*string\]:\s*Value<"1">\s*\};/,
    );
    expect(src).toMatch(
      /inputs\?:\s*\{\s*\[key:\s*string\]:\s*Value<"units\/s">\s*\};/,
    );
    expect(src).toMatch(
      /outputs\?:\s*\{\s*\[key:\s*string\]:\s*Value<"units\/s">\s*\};/,
    );
  });
});
