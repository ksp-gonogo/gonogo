// @vitest-environment node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  debtJson,
  gradePlant,
  scanPublishedDocCoverage,
} from "./published-doc-coverage.scan";
import {
  baseStringLists,
  ratchetBaseRef,
  readJsonObject,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Every export of a published entry point carries a doc comment and an
 * `@category`, because the reference site is generated from them and has no
 * page for an export without one.
 *
 * Held by `published-doc-coverage.debt.json`, one list of `subpath:name` per
 * package, which only shrinks. Each package's doc pass takes its list to zero;
 * `GONOGO_DOC_COVERAGE_UPDATE=<package>` rewrites that package's list with the
 * entries that now pass removed, and never adds one.
 */

const DEBT_PATH = "packages/core/src/published-doc-coverage.debt.json";
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const DOC_COVERAGE_DEBT = baseStringLists(
  { debt: readJsonObject(join(REPO_ROOT, DEBT_PATH)) },
  "debt",
);
if (!DOC_COVERAGE_DEBT)
  throw new Error(`${DEBT_PATH} is not a per-package list`);
const UPDATE = process.env.GONOGO_DOC_COVERAGE_UPDATE;
const RESULT = scanPublishedDocCoverage();

const now = (pkg: string): Set<string> =>
  new Set(RESULT.faults.get(pkg)?.keys() ?? []);

describe("design-system: published exports are documented", () => {
  it("grades the planted module before the tree", () => {
    const found = gradePlant().map((f) => `${f.name}:${f.missing}`);
    expect(
      found,
      "BLIND: the planted undocumented and uncategorised exports must both fail, and the documented one must not",
    ).toEqual(["undocumented:doc", "uncategorised:category"]);
  });

  it("reads every published package's author entry points", () => {
    console.info(
      `[doc-coverage] graded ${RESULT.graded} exports across ${RESULT.entries.length} entry points`,
    );
    const packages = new Set(RESULT.entries.map((e) => e.pkg));
    for (const pkg of [
      "@ksp-gonogo/sitrep-sdk",
      "@ksp-gonogo/ui-kit",
      "@ksp-gonogo/uplink-tools",
    ]) {
      expect(packages).toContain(pkg);
    }
    expect(RESULT.graded).toBeGreaterThan(500);
  });

  it("finds no fault outside the debt list", () => {
    const unlisted: string[] = [];
    for (const [pkg, faults] of RESULT.faults) {
      const listed = new Set(DOC_COVERAGE_DEBT[pkg] ?? []);
      for (const [key, missing] of faults) {
        if (!listed.has(key)) unlisted.push(`  ${pkg} ${key}  (no ${missing})`);
      }
    }
    expect(
      unlisted,
      `${unlisted.length} published export(s) without a doc comment or an @category. Document each, with the @category of the reference page it belongs on:\n${unlisted.join("\n")}`,
    ).toEqual([]);
  });

  it("lists no entry that now passes", () => {
    if (UPDATE) {
      const pkg = UPDATE;
      if (!(pkg in DOC_COVERAGE_DEBT)) {
        throw new Error(`${pkg} has no debt list to update`);
      }
      const remaining = DOC_COVERAGE_DEBT[pkg].filter((key) =>
        now(pkg).has(key),
      );
      writeFileSync(
        join(REPO_ROOT, DEBT_PATH),
        debtJson({ ...DOC_COVERAGE_DEBT, [pkg]: remaining }),
      );
      console.info(
        `[doc-coverage] ${pkg}: ${DOC_COVERAGE_DEBT[pkg].length - remaining.length} entries removed, ${remaining.length} left`,
      );
      return;
    }
    const stale: string[] = [];
    for (const [pkg, keys] of Object.entries(DOC_COVERAGE_DEBT)) {
      for (const key of keys) {
        if (!now(pkg).has(key)) stale.push(`  ${pkg} ${key}`);
      }
    }
    expect(
      stale,
      `${stale.length} debt entr(ies) now pass or name no export. Remove them with GONOGO_DOC_COVERAGE_UPDATE=<package>:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  /**
   * Against the ratchet base: a package's list may lose entries, and may gain
   * one only when its total did not rise, which is what a renamed or moved
   * export looks like.
   */
  it("never grows a package's list", () => {
    const at = ratchetBaseRef();
    if (!at) return;
    const source = sourceAtRatchetBase(at, DEBT_PATH);
    if (source === null) return;
    const parsed: unknown = JSON.parse(source);
    const before =
      typeof parsed === "object" && parsed !== null
        ? baseStringLists({ debt: parsed }, "debt")
        : undefined;
    expect(
      before,
      `${DEBT_PATH} at ${at.ref} is not a per-package list`,
    ).toBeDefined();
    const grown: string[] = [];
    for (const [pkg, keys] of Object.entries(DOC_COVERAGE_DEBT)) {
      const was = before?.[pkg];
      if (was === undefined) {
        grown.push(`  ${pkg}: a new list of ${keys.length}`);
        continue;
      }
      if (keys.length > was.length) {
        grown.push(`  ${pkg}: ${was.length} -> ${keys.length}`);
      }
    }
    expect(
      grown,
      `the doc-coverage debt grew since ${at.ref}. Document the new exports instead:\n${grown.join("\n")}`,
    ).toEqual([]);
  });
});
