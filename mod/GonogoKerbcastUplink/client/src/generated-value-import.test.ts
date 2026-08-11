import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The "resolves to a core gonogo Value type" half of the uplink-types-out-of-
// core plan's Unit guard (§5b): a wire-visible Value<"..."> / Vec3Of<"..."> in
// this Uplink's OWN generated contract must still resolve to the core
// unit-system module (@ksp-gonogo/sitrep-sdk), never a locally hand-rolled
// Value type. See KerbcastRtConfig.Configure's `valueImportFrom` argument,
// which is the mechanism this test verifies actually took effect in the
// emitted file, not just in the C# call site.
//
// NOT vacuous: KerbcastCameraEntry's nine Units.Degrees properties
// (fieldOfView/fieldOfViewMinimum/fieldOfViewMaximum, panYaw/panPitch, and
// their four min/max siblings) genuinely retype to Value<"deg"> (see
// ../__generated__/contract.ts), same as Avionics's two Units.Tonnes
// properties did. KerbcastSetFieldOfViewArgs/KerbcastSetPanArgs (command args,
// like MechJeb's two types) do NOT trip the branch: ApplyUnitValueTypes
// deliberately skips retyping inbound-only args, so this test's non-vacuity
// rests entirely on KerbcastCameraEntry, the read payload.

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

    // Not vacuous: KerbcastCameraEntry's nine Value<"deg"> fields make this true.
    expect(usesValueOrVec3Of).toBe(true);

    expect(source).toMatch(
      /import\s*\{\s*Value,\s*Vec3Of\s*\}\s*from\s*['"]@ksp-gonogo\/sitrep-sdk['"]/,
    );
  });
});
