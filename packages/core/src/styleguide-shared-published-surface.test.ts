import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Cross-package guard for the two PUBLISHED packages: a name exported by both
 * `@ksp-gonogo/sitrep-sdk` and `@ksp-gonogo/ui-kit` must resolve to ONE
 * declaration.
 *
 * The sibling `styleguide-duplicate-primitives.test.ts` gates the ui / ui-kit
 * pair, where the rule is simple because one package is private: ui-kit always
 * wins and the copy in `ui` becomes a re-export. This pair is different and
 * worse. BOTH are published, so a third-party Uplink can import either, and when
 * the same name is declared in each there is no wrong import for the author to
 * make: both compile, both look right, and they mean different things.
 *
 * What made this urgent rather than tidy is the declaration-merge seams.
 * `SlotRegistry` and `ContributionRegistry` were declared in both packages, and
 * the two halves of the repo merged into different ones: every Uplink writes
 * `declare module "@ksp-gonogo/sitrep-sdk"` and every in-repo widget writes
 * `declare module "@ksp-gonogo/core"` (which re-exported ui-kit's). Two authors
 * doing the same correct-looking thing landed on two interfaces, so `AugmentSlot`
 * never saw an Uplink's slot ids and `SlotProps` never saw a widget's, and
 * neither side could observe the other's absence. Converging them immediately
 * surfaced a real drift the conformance file had left to eyeball: the sdk's
 * mirrored `renderAlarm` returned `unknown` where the widget's returns
 * `ReactNode`.
 *
 * This gates the PROPERTY, not today's list. A re-export satisfies it, because a
 * re-export is one declaration; two `export interface X` do not, whatever their
 * fields say today. Identical copies are the worst case, not the acceptable one:
 * they are what drift starts as.
 *
 * `KNOWN_DIVERGENCES` is a shrink-only debt list, the same device this repo uses
 * for the uplink-isolation boundary, not a blessing. Its entries are the pairs
 * where the sdk's declaration is a HOST SHIM and ui-kit's is the registry it
 * ultimately reaches, which is a genuine architectural question rather than a
 * copy to delete: the shim is what carries an Uplink's `declare module
 * "@ksp-gonogo/sitrep-sdk"` slot ids and what throws a named error when the
 * package was not marked external. A NEW duplicate fails outright.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const SDK = join(REPO, "mod/sitrep-sdk/src");
const UI_KIT = join(REPO, "packages/ui-kit/src");

/** `export const|function|class|interface|type|enum Name` */
const DECLARED_RE =
  /^export\s+(?:default\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;

/**
 * Pairs still declared twice, each with the reason it is not simply a copy.
 * This list may only ever SHRINK. Removing an entry is the fix; adding one is
 * not available, a new duplicate is a failure.
 */
const KNOWN_DIVERGENCES: readonly string[] = [
  // The whole augment surface: the sdk's four are one-line shims onto `getHost()`,
  // ui-kit's are the registry those shims eventually reach. RULED that an Uplink
  // imports the sdk's, for reading as well as writing: the shim is what carries
  // the Uplink's own `declare module "@ksp-gonogo/sitrep-sdk"` slot ids, and what
  // throws a named error when the package was not marked external instead of
  // carrying on silently. The dead-registry symptom this list used to cite is no
  // longer among the reasons: ui-kit's registry moved into one `globalThis` slot
  // on 2026-09-01, so two loaded copies converge (`augments.second-copy.test.ts`).
  //
  // Enforced by `uplink-augment-route.test.ts`, not by narrowing ui-kit's barrel.
  // That was checked rather than assumed: `core/src/augments.ts` re-exports this
  // surface from ui-kit both to build the host and so a `declare module
  // "@ksp-gonogo/core"` merge of `SlotRegistry` still lands, so the names have to
  // stay on ui-kit's barrel and the rule has to be about who imports them.
  //
  // These four stay on this list because two declarations genuinely exist and the
  // guard cannot collapse them; what changed is that the route is now enforced
  // and a planted violation fails.
  "AugmentSlot",
  "clearAugments",
  "getAugmentsForSlot",
  "registerAugment",
  // Two independent unit registries with the same two entry points and
  // DIFFERENT signatures (`registerUnit(def: UnitDefinition)` here against
  // `registerUnit(registration: UnitRegistration)` there; `displaySymbol` takes
  // a token plus options here and a bare token there). Not a copy: two designs.
  // RULED that the sdk owns the unit system and ui-kit defers, but a merge is
  // held pending a measurement of what each registry actually holds: a token
  // present in only one of them is invisible to the other, which would be a
  // live defect rather than a duplication.
  "UnitDefinition",
  "displaySymbol",
  "registerUnit",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `dist` would double-count every declaration as its own build output.
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (/\.test-d\.ts$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** name -> repo-relative file that DECLARES it (a re-export is not a declaration). */
function declarations(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const [, name] of text.matchAll(DECLARED_RE)) {
      if (!found.has(name)) found.set(name, relative(REPO, file));
    }
  }
  return found;
}

/**
 * Floors on the two declaration maps, well under what each package declared when
 * these were written.
 *
 * `DECLARED_RE` ceasing to match is the failure this cannot otherwise express: a
 * barrel-only refactor, an `export default function`, a formatter moving `export`
 * off column 0, and both maps go empty, nothing is duplicated, and the gate
 * passes. The debt list is the only other thing that would notice, and it is
 * meant to reach zero, at which point it notices nothing.
 */
const MIN_DECLARATIONS: Record<string, number> = { sdk: 300, "ui-kit": 200 };

describe("a name published by both sdk and ui-kit resolves to one declaration", () => {
  const sdk = declarations(SDK);
  const kit = declarations(UI_KIT);
  const duplicated = [...kit.keys()].filter((name) => sdk.has(name)).sort();

  it("finds the declarations in both packages, so a green result means something", () => {
    for (const [label, size] of [
      ["sdk", sdk.size],
      ["ui-kit", kit.size],
    ] as const) {
      expect(
        size,
        `Found ${size} declaration(s) in ${label}, expected at least ${MIN_DECLARATIONS[label]}. ` +
          "An empty map has no duplicates, so it passes the gate below for the same reason a " +
          "clean tree does.",
      ).toBeGreaterThanOrEqual(MIN_DECLARATIONS[label]);
    }
  });

  it("declares no name in both packages, outside the shrink-only debt list", () => {
    const unexpected = duplicated
      .filter((name) => !KNOWN_DIVERGENCES.includes(name))
      .map((name) => `${name}  (${kit.get(name)}  vs  ${sdk.get(name)})`);

    expect(
      unexpected,
      unexpected.length === 0
        ? ""
        : `These names are DECLARED in both published packages:\n\n` +
            unexpected.map((d) => `  ${d}`).join("\n") +
            `\n\nBoth packages are published, so an Uplink author can import\n` +
            `either and neither import is wrong. Pick the one home and make the\n` +
            `other a re-export:\n\n` +
            `  export type { Thing } from "@ksp-gonogo/sitrep-sdk";\n\n` +
            `Default to the sdk: it is the leaf, and it is what a facade-sealed\n` +
            `client can always see. Identical fields are NOT a reason to leave\n` +
            `two declarations standing, that is what drift looks like on day one.\n` +
            `If the two genuinely mean different things, rename one.`,
    ).toEqual([]);
  });

  it("has no stale entry in the debt list", () => {
    const stale = KNOWN_DIVERGENCES.filter(
      (name) => !duplicated.includes(name),
    );

    expect(
      stale,
      `These entries no longer name a duplicate declaration, so the list is\n` +
        `describing work that is already done. Delete them, that is the whole\n` +
        `point of a shrink-only list:\n` +
        stale.map((n) => `  ${n}`).join("\n"),
    ).toEqual([]);
  });
});
