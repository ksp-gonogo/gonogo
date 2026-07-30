import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: a shared primitive is implemented ONCE, in
 * `@ksp-gonogo/ui-kit`.
 *
 * ui-kit is the published package, so it is the only one a third-party
 * Uplink can import. `@ksp-gonogo/ui` is app-side and private. When a
 * primitive exists in both, an Uplink and a built-in widget rendering "the
 * same" component are rendering two different components, and nothing says
 * so.
 *
 * This is not a tidiness rule, it has already cost real time twice:
 *
 *   - `Panel` was copied into ui-kit when that package was created rather
 *     than aliased back. Nothing noticed for months. The compound-Panel
 *     rework then improved only the ui copy, so `<Panel panelTitle="X">`
 *     was a type error from ui-kit, and ui-kit's `PanelBody` was a
 *     padding-only box that did not scroll, silently clipping overflow
 *     where the other one scrolled it. Twenty-nine widgets imported the
 *     stale one.
 *   - `Badge` was the same copy, caught here before it diverged: four
 *     widgets on one, nine on the other, identical apart from a doc
 *     comment. Given time it would have been Panel again.
 *
 * The fix in both cases is the same and is cheap: `packages/ui/src/X.tsx`
 * becomes a re-export from ui-kit. Thirteen of ui's files already are.
 *
 * What this does NOT forbid: a genuinely app-only primitive in ui (Modal,
 * Tabs, Gauge, LineChart and the rest are fine, they have no ui-kit twin),
 * or ui re-exporting a ui-kit name. Only a second IMPLEMENTATION.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const UI = join(REPO, "packages/ui/src");
const UI_KIT = join(REPO, "packages/ui-kit/src");

/** `export const|function|class|interface|type|enum Name` */
const DECLARED_RE =
  /^export\s+(?:default\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;

/** A file whose whole job is `export { … } from "@ksp-gonogo/ui-kit"`. */
const ALIASES_UI_KIT_RE =
  /export\s*\{[^}]*\}\s*from\s*["']@ksp-gonogo\/ui-kit["']/s;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (entry === "index.ts") continue;
    out.push(full);
  }
  return out;
}

/** name -> repo-relative file that declares it. */
function declarations(dir: string, skipAliases: boolean): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    if (skipAliases && ALIASES_UI_KIT_RE.test(text)) continue;
    for (const [, name] of text.matchAll(DECLARED_RE)) {
      if (!found.has(name)) found.set(name, relative(REPO, file));
    }
  }
  return found;
}

/**
 * Names that legitimately exist in both because they mean different things,
 * not because a component was copied. Keep this empty if you can: an entry
 * here is a naming collision that a reader has to hold in their head.
 */
const ALLOWED: readonly string[] = [];

describe("shared primitives are implemented once, in ui-kit", () => {
  it("no name is implemented in both @ksp-gonogo/ui and @ksp-gonogo/ui-kit", () => {
    const kit = declarations(UI_KIT, false);
    const app = declarations(UI, true);

    const duplicated = [...app.entries()]
      .filter(([name]) => kit.has(name) && !ALLOWED.includes(name))
      .map(([name, file]) => `${name}  (${file}  vs  ${kit.get(name)})`)
      .sort();

    expect(
      duplicated,
      duplicated.length === 0
        ? ""
        : `These names are implemented in BOTH packages:\n\n` +
            duplicated.map((d) => `  ${d}`).join("\n") +
            `\n\nui-kit is the canonical home for anything an Uplink may need.\n` +
            `Delete the copy in packages/ui and make that file a re-export:\n\n` +
            `  export { Thing, type ThingProps } from "@ksp-gonogo/ui-kit";\n\n` +
            `If the two genuinely mean different things, rename one. Adding to\n` +
            `ALLOWED in this file is the last resort, not the first.`,
    ).toEqual([]);
  });

  it("ui-kit does not import from the app-side ui package", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(UI_KIT)) {
      const text = readFileSync(file, "utf8");
      if (/from\s*["']@ksp-gonogo\/ui["']/.test(text)) {
        offenders.push(relative(REPO, file));
      }
    }

    expect(
      offenders,
      `ui-kit is published and ui is private, so this import would ship a\n` +
        `broken package. Move what is needed INTO ui-kit instead:\n` +
        offenders.map((f) => `  ${f}`).join("\n"),
    ).toEqual([]);
  });
});
