import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The "resolves to a core gonogo Value type" half of the Unit guard: a
// wire-visible Value<"..."> / Vec3Of<"..."> in this Uplink's OWN generated
// contract must still resolve to the core unit-system module
// (@ksp-gonogo/sitrep-sdk), never a locally hand-rolled Value type. See
// RealFuelsRtConfig.Configure's `valueImportFrom` argument, which is the
// mechanism this test verifies actually took effect in the emitted file rather
// than only in the C# call site.
//
// Not vacuous: every unit an operator reads here is a Value<> (ullage stability
// and ignition probability as Value<"ratio">, the boiloff rate as Value<"kg/s">),
// so the usage branch is exercised on every run.

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

    expect(usesValueOrVec3Of).toBe(true);

    expect(source).toMatch(
      /import\s*\{\s*Value,\s*Vec3Of\s*\}\s*from\s*['"]@ksp-gonogo\/sitrep-sdk['"]/,
    );
  });
});
