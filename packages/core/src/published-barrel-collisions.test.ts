// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching the other cross-package ratchets here: this one builds a TypeScript program over `ts.sys`.
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A name exported from BOTH published packages must resolve to the same
 * declaration, or be named below with which import to reach for.
 *
 * An Uplink author imports `@ksp-gonogo/sitrep-sdk` and
 * `@ksp-gonogo/ui-kit`, and a name on both is only safe when both spellings
 * reach one declaration: 27 of the 33 do, because ui-kit re-exports the sdk's
 * type. The six that do not are two real declarations behind one name, and
 * picking the wrong one compiles.
 *
 * `registerUnit` is the case the authoring guide already documents (the two
 * halves of a unit, aliased at the import). The augment three were not
 * documented anywhere: the sdk's are shims onto `getHost()` and ui-kit's are
 * the implementation, and while ui-kit's registry was a module static those
 * were the same `Map` only for as long as exactly one copy of ui-kit was
 * loaded. That is fixed at the registry rather than here, so an author who
 * picks either one now lands in the same place; the entries stay because the
 * divergence itself is what a reader has to be told about.
 *
 * This lives in core for the same reason `uplink-isolation` does: the rule
 * spans `mod/sitrep-sdk` and `packages/ui-kit`, so it cannot live in either.
 *
 * Exports are computed with the checker's `getExportsOfModule` and aliases are
 * followed to a declaration, rather than read off `export` lines. A text-level
 * comparison of the two barrels under-collects badly: it reports 12 of the 33,
 * and misses all three augment shims, which are the ones that mattered.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const BARRELS = {
  "@ksp-gonogo/sitrep-sdk": join(REPO_ROOT, "mod/sitrep-sdk/src/index.ts"),
  "@ksp-gonogo/ui-kit": join(REPO_ROOT, "packages/ui-kit/src/index.ts"),
} as const;

/**
 * Collisions whose two declarations genuinely differ, mapped to what an author
 * needs to know. Every entry is a decision that was made; a name arriving here
 * unlisted is one that has not been.
 */
const DIVERGENT_COLLISIONS: Readonly<Record<string, string>> = {
  AugmentSlot:
    "the sdk's is a shim rendering `getHost().AugmentSlot`, so it composes the app's single registry; ui-kit's is that component. A widget should take it from ui-kit, which is where the render-time presence gating lives",
  clearAugments:
    "the sdk's routes through `getHost()` and throws a named error when no host is installed; ui-kit's is the registry function and works without one. Either reaches the same registry",
  getAugmentsForSlot: "same pair as `clearAugments`",
  registerAugment: "same pair as `clearAugments`",
  registerUnit:
    "different halves of a unit and NOT interchangeable: the sdk's registers the dimension and conversion, ui-kit's the display formatting. The authoring guide imports the second as `registerDisplayUnit`",
  UnitDefinition: "the descriptor for whichever `registerUnit` you called",
};

/** `name -> the file its declaration is in`, for one barrel. */
function resolvedExports(
  program: ts.Program,
  checker: ts.TypeChecker,
  entry: string,
): Map<string, string> {
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`barrel not in the program: ${entry}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`barrel has no module symbol: ${entry}`);
  const out = new Map<string, string>();
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    let target = symbol;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        target = checker.getAliasedSymbol(symbol);
      } catch {
        /*
         * An alias that cannot be resolved is left as itself: its declaration is
         * then the re-export statement, which still names a file, and a
         * barrel-to-barrel comparison of two such is still meaningful.
         */
      }
    }
    const file = target.declarations?.[0]?.getSourceFile().fileName;
    if (file) out.set(symbol.getName(), file.replace(`${REPO_ROOT}/`, ""));
  }
  return out;
}

function collisions(): { name: string; sdk: string; kit: string }[] {
  const program = ts.createProgram(Object.values(BARRELS), {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const sdk = resolvedExports(
    program,
    checker,
    BARRELS["@ksp-gonogo/sitrep-sdk"],
  );
  const kit = resolvedExports(program, checker, BARRELS["@ksp-gonogo/ui-kit"]);
  const found: { name: string; sdk: string; kit: string }[] = [];
  for (const [name, sdkFile] of sdk) {
    const kitFile = kit.get(name);
    if (kitFile) found.push({ name, sdk: sdkFile, kit: kitFile });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

describe("names exported from both published packages", () => {
  it("finds both barrels' exports, so a green result means something", () => {
    // Without this, a barrel that stopped resolving would empty the comparison
    // and the check below would report no divergent collisions at all.
    const all = collisions();
    expect(all.length).toBeGreaterThan(20);
    expect(all.map((c) => c.name)).toContain("registerUnit");
  });

  it("resolves every collision to one declaration, or names the divergence", () => {
    const undecided = collisions()
      .filter((c) => c.sdk !== c.kit)
      .filter((c) => !(c.name in DIVERGENT_COLLISIONS))
      .map((c) => `${c.name}: sdk=${c.sdk} ui-kit=${c.kit}`);
    expect(
      undecided,
      [
        "A name is exported from both published packages with a DIFFERENT",
        "declaration behind each, and nothing tells an author which to import.",
        "",
        "Both spellings compile and only one is right, which is why no other gate",
        "sees this: `styleguide-duplicate-primitives` compares ui against ui-kit,",
        "and the isolation ratchets read imports rather than what they resolve to.",
        "",
        "Either make ui-kit re-export the sdk's declaration, so the two names are",
        "one thing, or add an entry to DIVERGENT_COLLISIONS in",
        "packages/core/src/published-barrel-collisions.test.ts saying which import",
        "an author should reach for and why.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("carries no entry for a collision that has since converged", () => {
    /*
     * An entry left behind after ui-kit starts re-exporting the sdk's
     * declaration documents a hazard that no longer exists, which is how a list
     * like this stops being read.
     */
    const divergent = new Set(
      collisions()
        .filter((c) => c.sdk !== c.kit)
        .map((c) => c.name),
    );
    const stale = Object.keys(DIVERGENT_COLLISIONS).filter(
      (name) => !divergent.has(name),
    );
    expect(stale).toEqual([]);
  });
});
