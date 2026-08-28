// @vitest-environment node
//
// Node realm: this walks an import graph off disk.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `page-check` must never pull Playwright or esbuild.
 *
 * It is the half of the page gate an author with no browser can run, and the
 * whole reason it exists is that fusing the prose question to the picture
 * question made the cheap one cost as much as the expensive one. A single
 * `import` of the driver, added later by someone tidying re-exports, would undo
 * that with nothing to say so: the check would still pass on a machine that has
 * Playwright, which is every machine anyone develops on.
 *
 * Asserted on the SOURCE import graph rather than on `dist/`, deliberately. A
 * test that reads a build artifact has to decide what to do when there is no
 * build, and both answers are bad: skipping is a silent pass, and failing makes
 * `pnpm test` depend on `pnpm build`. The source graph is always there.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");

/** Specifiers that would make this entry cost a browser. */
const FORBIDDEN = ["playwright", "esbuild"];

/**
 * Value imports only. A `import type { X } from "./driver"` is erased outright,
 * so following it would report a browser dependency the built file does not
 * have: `docs.ts` names `RenderedAsset` that way and nothing else about it
 * reaches Playwright. The `type` keyword right after `import` or `export` is
 * what makes a whole statement disappear; an inline `{ type X, y }` does not,
 * and is deliberately still followed.
 */
const IMPORT_RE =
  /(?:^|[\n;])[ \t]*(?:import|export)[ \t]+(?!type[ \t])[^"';]*["']([^"']+)["']|(?:^|[\n;])[ \t]*import[ \t]*["']([^"']+)["']/g;

/**
 * A DYNAMIC `import("x")` anywhere in an expression, which the statement form
 * above cannot see: it anchors to the start of a line or statement, and a lazy
 * import lives inside a function body after an `=` or an `await`.
 *
 * Added when `driver.ts` made its Playwright import lazy, so the driver stopped
 * naming it statically and this file's positive control went quiet. A walk that
 * can no longer see the thing it is looking for reports clean, so the reach had
 * to grow with the change rather than the assertion shrinking to match it.
 *
 * `import type` cannot appear in this form, so there is no type case to exclude.
 */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Resolve a relative specifier to a file on disk, trying the usual endings. */
function resolveLocal(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        if (readFileSync(candidate).length >= 0) return candidate;
      } catch {
        // A directory, not a file: keep trying the other endings.
      }
    }
  }
  return undefined;
}

/** Every module reachable from `entry` through RELATIVE imports, plus the bare
 *  specifiers those modules name. */
function walk(entry: string): { files: string[]; bare: Set<string> } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of [
      ...source.matchAll(IMPORT_RE),
      ...source.matchAll(DYNAMIC_IMPORT_RE),
    ]) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      if (specifier.startsWith(".")) {
        const resolved = resolveLocal(file, specifier);
        if (resolved) queue.push(resolved);
        continue;
      }
      bare.add(specifier);
    }
  }
  return { files: [...seen], bare };
}

describe("the browserless page check stays browserless", () => {
  const entry = join(SRC, "page-check.ts");
  const graph = walk(entry);

  it("reaches more than one module, so a silent zero cannot pass for clean", () => {
    // A resolver that resolved nothing would find no forbidden import and
    // report perfect. The floor only has to prove the walk happened.
    expect(graph.files.length).toBeGreaterThan(3);
  });

  it("names neither playwright nor esbuild anywhere it can reach", () => {
    const offenders = [...graph.bare].filter((specifier) =>
      FORBIDDEN.some(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("proves the walk would SEE one, by walking the entry that has them", () => {
    // The instrument checked against a known positive. `render.ts` is the node
    // driver and genuinely does import both, so a walk that comes back clean
    // there is a walk that cannot see anything.
    const driver = walk(join(SRC, "render.ts"));
    expect(
      [...driver.bare].filter((s) => FORBIDDEN.includes(s)).sort(),
    ).toEqual(["esbuild", "playwright"]);
  });
});
