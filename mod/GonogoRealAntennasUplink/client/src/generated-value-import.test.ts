import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The "resolves to a core gonogo Value type" half of the uplink-types-out-of-core
// plan's Unit guard: a wire-visible Value<"..."> in this Uplink's OWN
// generated contract must still resolve to the core unit-system module
// (@ksp-gonogo/sitrep-sdk), never a locally hand-rolled Value type. See
// RealAntennasRtConfig.Configure's `valueImportFrom` argument, which is the
// mechanism this test verifies actually took effect in the emitted file, not just
// in the C# call site.
//
// The densest slice of the seven on units, and the least at risk of going
// vacuous: FOUR properties across three types retype (a ratio, two bit rates, a
// decibel margin), so every interface here carries at least one Value. Each is
// pinned by name below anyway, because "the file has some Value in it" would
// survive three of the four silently reverting to bare numbers.

const generatedContractPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "__generated__/contract.ts",
);

const source = () => readFileSync(generatedContractPath, "utf8");

describe("generated contract.ts: Value usage resolves to core", () => {
  it("imports Value from @ksp-gonogo/sitrep-sdk whenever it is used", () => {
    const src = source();
    const usesValueOrVec3Of = /\b(Value|Vec3Of)</.test(
      src.replace(/^import.*$/gm, ""), // strip the import lines before checking USAGE
    );

    expect(usesValueOrVec3Of).toBe(true);
    expect(src).toMatch(
      /import\s*\{\s*Value,\s*Vec3Of\s*\}\s*from\s*['"]@ksp-gonogo\/sitrep-sdk['"]/,
    );
  });

  it("keeps every declared quantity typed as a Value, by name", () => {
    const src = source();

    expect(src).toMatch(/value:\s*Value<"ratio">;/);
    expect(src).toMatch(/upBitsPerSec:\s*Value<"bit\/s">;/);
    expect(src).toMatch(/downBitsPerSec:\s*Value<"bit\/s">;/);
    expect(src).toMatch(/decibelMargin:\s*Value<"dB">;/);
  });

  // The contrast case. `closesLink` declares Units.Flag, which
  // ApplyUnitValueTypes leaves alone by design, so it must stay a bare boolean.
  // It is what proves the retyping is driven by the TOKEN rather than by "has a
  // [SitrepUnit] attribute". It was the slice's only non-quantity until the
  // targeting surface arrived with flags, ids and free text of its own; it stays
  // the case asserted here because it is the one on a channel that predates them.
  it("leaves the annotated non-quantity bare", () => {
    expect(source()).toMatch(/closesLink:\s*boolean;/);
  });

  // `meta` is the first PayloadMeta any relocated slice has carried, and the
  // first core type an Uplink's generated file has had to name. rtcli only knows
  // the types the run exports, so without the explicit import + retype in
  // RealAntennasRtConfig it degrades to `any` with an RT0003 warning and the
  // source/quality pair every consumer reads loses its type. A regression there
  // is invisible at runtime and would only surface as `meta.quality` typing as
  // `any` in a widget nobody has written yet, which is precisely the kind of rot
  // that goes unnoticed.
  it("resolves the core PayloadMeta rather than degrading it to any", () => {
    const src = source();

    expect(src).toMatch(
      /import\s*\{\s*PayloadMeta\s*\}\s*from\s*['"]@ksp-gonogo\/sitrep-sdk['"]/,
    );
    expect(src).not.toMatch(/meta:\s*any;/);
    // The three link channels plus the per-antenna targeting state.
    expect(src.match(/meta:\s*PayloadMeta;/g)).toHaveLength(4);
  });
});
