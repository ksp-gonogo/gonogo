import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleguideScanRoots } from "./styleguideScanRoots";

/**
 * A search field is the kit's `SearchBox`, never a raw `type="search"` input.
 *
 * The browser draws its own clear control on a search input, a blue X that
 * ignores the theme. The kit hides it and draws one of its own, and only
 * `SearchBox` carries both halves, so a local search input anywhere else gets
 * the browser's X back or no clear control at all.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** The one file allowed to set the type, because it is the primitive. */
const PRIMITIVE = "packages/ui-kit/src/SearchBox.tsx";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__generated__")
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.test\.tsx?$/.test(name)) continue;
    if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments stripped, so a paragraph about a search input is not one. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * The JSX attribute in every quoting, and the object-property form an
 * `.attrs()` call or a `createElement` props bag would use.
 */
const SEARCH_TYPE =
  /(?<![A-Za-z0-9_$])type\s*(?:=\s*\{?\s*|:\s*)(["'`])search\1/g;

/** How many times a source sets an input's type to search. */
function searchTypesIn(code: string): number {
  return [...stripComments(code).matchAll(SEARCH_TYPE)].length;
}

describe("a search field is the kit's SearchBox", () => {
  it("no source outside SearchBox renders a raw search input", () => {
    const offenders: string[] = [];
    let files = 0;
    for (const root of styleguideScanRoots(REPO_ROOT)) {
      for (const file of walk(join(REPO_ROOT, root))) {
        files++;
        const rel = relative(REPO_ROOT, file);
        if (rel === PRIMITIVE) continue;
        const count = searchTypesIn(readFileSync(file, "utf8"));
        if (count > 0) offenders.push(`${rel}: ${count}`);
      }
    }
    /* A walk that reaches only a handful of files has stopped reaching the tree. */
    expect(files).toBeGreaterThan(500);
    expect(
      offenders,
      `A type="search" input draws the browser's own clear control, which ` +
        `ignores the theme. Render <SearchBox> from @ksp-gonogo/ui-kit, which ` +
        `hides it and draws the kit's.`,
    ).toEqual([]);
  });

  it("sees the one search input the primitive itself renders", () => {
    expect(
      searchTypesIn(readFileSync(join(REPO_ROOT, PRIMITIVE), "utf8")),
    ).toBe(1);
  });

  it.each([
    ['<input type="search" />', "a double-quoted attribute"],
    ["<input type='search' />", "a single-quoted attribute"],
    ['<Field type={"search"} value={q} />', "a braced string"],
    ["<Field type={`search`} />", "a template literal"],
    ['styled.input.attrs({ type: "search" })``', "an attrs object"],
    ['createElement("input", { type : "search" })', "a props bag"],
  ])("refuses %s (%s)", (source) => {
    expect(searchTypesIn(source)).toBe(1);
  });

  it.each([
    ['<input type="text" />', "another input type"],
    ['<button type="button">search</button>', "the word as content"],
    ['const inputType = "search";', "a different name"],
    ['// <input type="search" />', "a line comment"],
    ['/* <input type="search" /> */', "a block comment"],
  ])("accepts %s (%s)", (source) => {
    expect(searchTypesIn(source)).toBe(0);
  });
});
