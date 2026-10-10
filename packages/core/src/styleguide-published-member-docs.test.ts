// @vitest-environment node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  gradeMemberPlant,
  memberDebtJson,
  scanPublishedMemberDocs,
} from "./published-member-docs.scan";
import {
  baseStringLists,
  ratchetBaseRef,
  readJsonObject,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Every member of an exported interface, object-typed alias or class carries a
 * doc comment, because the reference site prints each type's members in a
 * table and a member with no comment leaves its description empty.
 *
 * Held by `published-member-docs.debt.json`, one list of
 * `subpath:Type#member` per package, which only shrinks.
 * `GONOGO_MEMBER_DOCS_UPDATE=<package>` rewrites that package's list with the
 * entries that now pass removed, and never adds one.
 */

const DEBT_PATH = "packages/core/src/published-member-docs.debt.json";
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const MEMBER_DEBT = baseStringLists(
  { debt: readJsonObject(join(REPO_ROOT, DEBT_PATH)) },
  "debt",
);
if (!MEMBER_DEBT) throw new Error(`${DEBT_PATH} is not a per-package list`);
const UPDATE = process.env.GONOGO_MEMBER_DOCS_UPDATE;
const RESULT = scanPublishedMemberDocs();

const now = (pkg: string): Set<string> => new Set(RESULT.faults.get(pkg) ?? []);

describe("design-system: published exports are documented", () => {
  it("grades the planted module before the tree", () => {
    expect(
      gradeMemberPlant(),
      "BLIND: the planted undocumented members must fail, and the documented, @internal, private and underscored ones must not",
    ).toEqual(["Plant#bare", "Shape#bare", "Klass#bare", "Klass#method"]);
  });

  it("reads every published package's author entry points", () => {
    console.info(
      `[member-docs] graded ${RESULT.graded} members across ${RESULT.entries.length} entry points`,
    );
    const packages = new Set(RESULT.entries.map((e) => e.pkg));
    for (const pkg of [
      "@ksp-gonogo/sitrep-sdk",
      "@ksp-gonogo/ui-kit",
      "@ksp-gonogo/uplink-tools",
    ]) {
      expect(packages).toContain(pkg);
    }
    expect(RESULT.graded).toBeGreaterThan(2000);
  });

  it("finds no fault outside the debt list", () => {
    const unlisted: string[] = [];
    for (const [pkg, faults] of RESULT.faults) {
      const listed = new Set(MEMBER_DEBT[pkg] ?? []);
      for (const key of faults) {
        if (!listed.has(key)) unlisted.push(`  ${pkg} ${key}`);
      }
    }
    expect(
      unlisted,
      `${unlisted.length} published member(s) without a doc comment. Give each one sentence saying what it holds:\n${unlisted.join("\n")}`,
    ).toEqual([]);
  });

  it("lists no entry that now passes", () => {
    if (UPDATE) {
      const pkg = UPDATE;
      if (!(pkg in MEMBER_DEBT)) {
        throw new Error(`${pkg} has no debt list to update`);
      }
      const remaining = MEMBER_DEBT[pkg].filter((key) => now(pkg).has(key));
      writeFileSync(
        join(REPO_ROOT, DEBT_PATH),
        memberDebtJson({ ...MEMBER_DEBT, [pkg]: remaining }),
      );
      console.info(
        `[member-docs] ${pkg}: ${MEMBER_DEBT[pkg].length - remaining.length} entries removed, ${remaining.length} left`,
      );
      return;
    }
    const stale: string[] = [];
    for (const [pkg, keys] of Object.entries(MEMBER_DEBT)) {
      for (const key of keys) {
        if (!now(pkg).has(key)) stale.push(`  ${pkg} ${key}`);
      }
    }
    expect(
      stale,
      `${stale.length} debt entr(ies) now pass or name no export. Remove them with GONOGO_MEMBER_DOCS_UPDATE=<package>:\n${stale.join("\n")}`,
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
    for (const [pkg, keys] of Object.entries(MEMBER_DEBT)) {
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
