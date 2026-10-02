// @vitest-environment node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { debtJson } from "./published-doc-coverage.scan";
import { gradePlant, scanPublishedIntent } from "./published-intent.scan";
import {
  baseStringLists,
  ratchetBaseRef,
  readJsonObject,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Every value a published entry point exports is either named by some other
 * source file, or says why it is published anyway with an `@intent` tag, such
 * as plumbing kept so a third party can build a representation of its own.
 * The surface stays deliberate: an export nobody uses and nobody defends is
 * dead weight an author will build against.
 *
 * Held by `published-intent.debt.json`, one list of `subpath:name` per
 * package, which only shrinks. `GONOGO_INTENT_UPDATE=1` rewrites it with the
 * entries that now pass removed, and never adds one.
 */

const DEBT_PATH = "packages/core/src/published-intent.debt.json";
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const DEBT = baseStringLists(
  { debt: readJsonObject(join(REPO_ROOT, DEBT_PATH)) },
  "debt",
);
if (!DEBT) throw new Error(`${DEBT_PATH} is not a per-package list`);
const UPDATE = process.env.GONOGO_INTENT_UPDATE === "1";
const RESULT = scanPublishedIntent();

const now = (pkg: string): Set<string> => RESULT.faults.get(pkg) ?? new Set();

describe("design-system: published exports carry a consumer or an intent", () => {
  it("grades the planted module before the tree", () => {
    expect(
      gradePlant(),
      "BLIND: the planted export with no consumer and no @intent must fail, and the used and the declared ones must not",
    ).toEqual(["unused"]);
  });

  it("reads every published package", () => {
    console.info(
      `[published-intent] graded ${RESULT.graded} value exports, ${RESULT.declared} kept by an @intent`,
    );
    for (const pkg of [
      "@ksp-gonogo/sitrep-sdk",
      "@ksp-gonogo/ui-kit",
      "@ksp-gonogo/uplink-tools",
    ]) {
      expect(RESULT.faults.has(pkg), `${pkg} was not graded`).toBe(true);
    }
    expect(RESULT.graded).toBeGreaterThan(500);
  });

  it("finds no export without a consumer or an @intent outside the debt list", () => {
    const unlisted: string[] = [];
    for (const [pkg, keys] of RESULT.faults) {
      const listed = new Set(DEBT[pkg] ?? []);
      for (const key of keys)
        if (!listed.has(key)) unlisted.push(`  ${pkg} ${key}`);
    }
    expect(
      unlisted,
      `${unlisted.length} published export(s) nothing else uses. Remove the export, or tag its doc comment with @intent and the reason it is published for a third party:\n${unlisted.join("\n")}`,
    ).toEqual([]);
  });

  it("lists no entry that now passes", () => {
    if (UPDATE) {
      const next = Object.fromEntries(
        Object.entries(DEBT).map(([pkg, keys]) => [
          pkg,
          keys.filter((key) => now(pkg).has(key)),
        ]),
      );
      writeFileSync(join(REPO_ROOT, DEBT_PATH), debtJson(next));
      return;
    }
    const stale: string[] = [];
    for (const [pkg, keys] of Object.entries(DEBT)) {
      for (const key of keys) {
        if (!now(pkg).has(key)) stale.push(`  ${pkg} ${key}`);
      }
    }
    expect(
      stale,
      `${stale.length} debt entr(ies) now have a consumer or an @intent. Remove them with GONOGO_INTENT_UPDATE=1:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

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
    for (const [pkg, keys] of Object.entries(DEBT)) {
      const was = before?.[pkg];
      if (was === undefined) continue;
      if (keys.length > was.length) {
        grown.push(`  ${pkg}: ${was.length} -> ${keys.length}`);
      }
    }
    expect(
      grown,
      `the intent debt grew since ${at.ref}. Give the new export a consumer or an @intent instead:\n${grown.join("\n")}`,
    ).toEqual([]);
  });
});
