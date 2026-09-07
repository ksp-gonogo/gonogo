import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: no wholesale `export *` from an internal package on the
 * ui-kit barrel.
 *
 * ui-kit is the PUBLISHED package: every name it exports is API a third-party
 * Uplink can import, chosen one name at a time. A star export breaks that
 * choice, anything the re-exported package's own barrel gains later becomes
 * ui-kit API with nobody having reviewed it.
 *
 * `export * from "@ksp-gonogo/theme"` did exactly this until it was replaced
 * with an explicit named list. This guard keeps it from coming back, and
 * keeps a new one from opening the same hole against a different internal
 * package. Per CLAUDE.md, `@ksp-gonogo/ui-kit` and `@ksp-gonogo/sitrep-sdk`
 * are the only two published workspace packages; everything else under the
 * `@ksp-gonogo/` scope is `private: true`, so a star export from any of them
 * is the same hole.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const UI_KIT_BARREL = join(REPO, "packages/ui-kit/src/index.ts");

const PUBLISHED_PACKAGES = new Set(["ui-kit", "sitrep-sdk"]);

/** Every `export * from "@ksp-gonogo/<pkg>"` target naming an internal (unpublished) package. */
function wildcardInternalExports(barrelSource: string): string[] {
  const found: string[] = [];
  for (const [, pkg] of barrelSource.matchAll(
    /export\s*\*\s*from\s*["']@ksp-gonogo\/([a-z0-9-]+)["']/g,
  )) {
    if (!PUBLISHED_PACKAGES.has(pkg)) found.push(pkg);
  }
  return found;
}

const BARREL_SOURCE = readFileSync(UI_KIT_BARREL, "utf8");

describe("ui-kit barrel never wildcard-exports an internal package", () => {
  it('has no `export * from "@ksp-gonogo/<internal>"`', () => {
    const offenders = wildcardInternalExports(BARREL_SOURCE);

    expect(
      offenders,
      `ui-kit's barrel wildcard-exports these internal packages:\n\n` +
        offenders.map((o) => `  @ksp-gonogo/${o}`).join("\n") +
        `\n\nName the exports explicitly. ui-kit is published, so anything the\n` +
        `internal package's own barrel gains later would otherwise become\n` +
        `third-party API with no review step.`,
    ).toEqual([]);
  });

  it("sees a violation when there is one", () => {
    // A regex that stops matching yields an empty offender list, and an empty
    // list reads as success. Fail on a planted violation before trusting a pass.
    const planted = [
      'export * from "@ksp-gonogo/theme";',
      'export * from "@ksp-gonogo/ui-kit";',
      'export * from "@ksp-gonogo/sitrep-sdk";',
      'export { ActionButton } from "./ActionButton";',
    ].join("\n");

    expect(wildcardInternalExports(planted)).toEqual(["theme"]);
  });
});
