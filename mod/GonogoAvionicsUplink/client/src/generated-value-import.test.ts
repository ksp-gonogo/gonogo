import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The "resolves to a core gonogo Value type" half of the uplink-types-out-of-
// core plan's Unit guard (§5b): a wire-visible Value<"..."> / Vec3Of<"..."> in
// this Uplink's OWN generated contract must still resolve to the core
// unit-system module (@ksp-gonogo/sitrep-sdk), never a locally hand-rolled
// Value type. See AvionicsRtConfig.Configure's `valueImportFrom` argument,
// which is the mechanism this test verifies actually took effect in the
// emitted file, not just in the C# call site.
//
// UNLIKE the MechJeb pilot's copy of this test (whose two command-arg types
// never trip the "uses Value<>" branch, so it only proved the ASSERTION
// worked), this one is NOT vacuous: AvionicsStatus is an outbound READ
// payload, so ControllableMassTons/VesselMassTons genuinely retype to
// Value<"t"> (see ../__generated__/contract.ts), and this test exercises the
// real branch below on every run.

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

    // Not vacuous: AvionicsStatus's two Value<"t"> fields make this true.
    expect(usesValueOrVec3Of).toBe(true);

    expect(source).toMatch(
      /import\s*\{\s*Value,\s*Vec3Of\s*\}\s*from\s*['"]@ksp-gonogo\/sitrep-sdk['"]/,
    );
  });
});
