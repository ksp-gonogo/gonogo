import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The "resolves to a core gonogo Value type" half of the uplink-types-out-of-
// core plan's Unit guard (§5b): a wire-visible Value<"..."> / Vec3Of<"..."> in
// this Uplink's OWN generated contract must still resolve to the core
// unit-system module (@ksp-gonogo/sitrep-sdk), never a locally hand-rolled
// Value type. See MechJebRtConfig.Configure's `valueImportFrom` argument,
// which is the mechanism this test verifies actually took effect in the
// emitted file, not just in the C# call site.
//
// MechJebAscentArgs/MechJebNoArgs are both command ARGS (inbound-only), and
// RtConfig.ApplyUnitValueTypes deliberately never retypes an Args property to
// Value<>/Vec3Of<> (see its own doc comment): so this file's generated
// contract.ts today carries the import line but never actually USES Value</
// Vec3Of< in a property type. This test still asserts the general rule (if
// the generated file ever DOES use one, its import must resolve to
// @ksp-gonogo/sitrep-sdk), so it is ready without edits the moment a future
// Uplink type here needs one; today the "uses Value<>" half is vacuously
// true. Avionics (AvionicsStatus, an outbound read-side payload) is the next
// Uplink in the plan's sequencing and will be the first to actually exercise
// this with a real Value<> usage.

const generatedContractPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "__generated__/contract.ts",
);

describe("generated contract.ts: Value/Vec3Of usage resolves to core", () => {
  it("imports Value/Vec3Of from @ksp-gonogo/sitrep-sdk whenever either is used", () => {
    const source = readFileSync(generatedContractPath, "utf8");
    const usesValueOrVec3Of = /\b(Value|Vec3Of)</.test(
      source.replace(/^import.*$/m, ""), // strip the import line itself before checking USAGE
    );

    if (!usesValueOrVec3Of) {
      // Vacuously true today: see the file-header comment above.
      return;
    }

    expect(source).toMatch(
      /import\s*\{\s*Value,\s*Vec3Of\s*\}\s*from\s*['"]@ksp-gonogo\/sitrep-sdk['"]/,
    );
  });
});
