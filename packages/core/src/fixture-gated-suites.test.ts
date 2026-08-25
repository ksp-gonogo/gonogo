import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_GATED_SUITES,
  fixtureGatedTestCount,
} from "./fixture-gated-suites";

/**
 * Holds the set of never-runs-in-CI suites to the ones that are written down.
 *
 * The register next door says WHY they cannot run and what is lost. This says
 * the register still describes the code, because a register that has drifted
 * is worse than none: it reads as an audited set while the real set is bigger.
 *
 * Both directions, because both fail silently:
 *
 * - a `skipIf` suite absent from the register is coverage that stopped running
 *   with nobody counting it
 * - a register entry whose file is gone, or whose test count no longer matches,
 *   is a claim about coverage that is not there to lose
 *
 * It deliberately does NOT fail when a fixture is missing. That is the normal
 * state in CI and failing on it would be a permanently red check, which this
 * repo has already learned hides the next real failure behind it (see `visual`).
 * Loudness comes from `scripts/report-fixture-gated-suites.mjs`, which prints
 * the register and the count in the `test` job's own log, so "these did not
 * run" is a line somebody reads rather than an absence nobody does.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/** Test files containing a `describe.skipIf(` gate, repo-relative. */
function suitesWithSkipIf(): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        "grep",
        "--untracked",
        "-lE",
        String.raw`describe\.skipIf\(`,
        "--",
        "*.test.ts",
        "*.test.tsx",
      ],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 8 },
    );
  } catch (err) {
    // Exit 1 is "no matches", which here would mean every gated suite lost its
    // gate at once. The floor below is what refuses to read that as success.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out
    .split("\n")
    .filter(
      (line) => line.length > 0 && !line.includes("/dist/") && !SELF.has(line),
    )
    .sort();
}

/**
 * This file and the register itself, which the scan finds because they QUOTE
 * the pattern rather than use it. Inventory naming its own subject, the same
 * carve-out the uplink-boundary allowlist's ratchet-inventory bucket makes.
 */
const SELF: ReadonlySet<string> = new Set([
  "packages/core/src/fixture-gated-suites.ts",
  "packages/core/src/fixture-gated-suites.test.ts",
]);

/**
 * `it(...)` bodies INSIDE the gated describe, which is the coverage that does
 * not run, minus the one-line SKIPPED placeholder the suite registers so the
 * skip shows up in a reporter. A file's other suites are outside the gate and
 * run normally, so counting the whole file would overstate what is lost.
 *
 * Brace-matched from the describe's own body rather than "to end of file":
 * these three happen to be last in their files today and a count that depends
 * on that would drift the moment one is not.
 */
function gatedTestCount(file: string): number {
  const source = readFileSync(join(ROOT, file), "utf8");
  const call = source.search(/describe\.skipIf\(/);
  if (call === -1) return 0;
  // From the describe body's opening brace, not from the call: the skipIf
  // ARGUMENT is parenthesised too, so paren-matching from the call closes on
  // `describe.skipIf(!fixtureExists)` and measures nothing.
  const start = source.indexOf("{", call);
  if (start === -1) return 0;
  let depth = 0;
  let end = source.length;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(start, end);
  const all = body.match(/(?<![A-Za-z0-9_$.])it(?:\.\w+)?\(/g)?.length ?? 0;
  const placeholders = body.match(/it\("SKIPPED:/g)?.length ?? 0;
  return all - placeholders;
}

describe("suites that cannot run in CI are declared, not merely skipped", () => {
  const scanned = suitesWithSkipIf();

  /**
   * Guard on the guard. A `git grep` whose pattern, globs or cwd are wrong
   * returns nothing, and nothing reads as "no undeclared skipped suites". The
   * register is non-empty by construction, so the scan must find at least as
   * many files as it names.
   */
  it("can still find the suites it is about, so an empty result is not a pass", () => {
    expect(scanned.length).toBeGreaterThanOrEqual(FIXTURE_GATED_SUITES.length);
  });

  it("has an entry for every fixture-gated suite in the tree", () => {
    const registered = new Set(FIXTURE_GATED_SUITES.map((s) => s.file));
    const undeclared = scanned.filter((file) => !registered.has(file));
    if (undeclared.length > 0) {
      throw new Error(
        "These suites skip themselves when a fixture is absent and are not on " +
          "the register, so nothing counts them and a run that executed none " +
          "of them reports as passing. Add an entry to " +
          "`fixture-gated-suites.ts` saying which fixture gates them and what " +
          "is lost without it, or better, commit a fixture they can run " +
          "against:\n" +
          undeclared.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(undeclared).toEqual([]);
  });

  it("names only suites that still exist, with the counts they still have", () => {
    const wrong: string[] = [];
    for (const suite of FIXTURE_GATED_SUITES) {
      if (!existsSync(join(ROOT, suite.file))) {
        wrong.push(`  ${suite.file}: no such file, drop the entry`);
        continue;
      }
      const actual = gatedTestCount(suite.file);
      if (actual !== suite.tests) {
        wrong.push(
          `  ${suite.file}: register says ${suite.tests} test(s), file has ${actual}`,
        );
      }
    }
    if (wrong.length > 0) {
      throw new Error(
        "The register no longer describes the code. It exists to say how much " +
          "coverage is not running, so a count that has drifted is the one " +
          "thing it must not do:\n" +
          wrong.join("\n"),
      );
    }
    expect(wrong).toEqual([]);
  });

  /**
   * Not an assertion about the fixtures, which are absent in CI by design.
   * This pins that the register describes a non-trivial amount of coverage, so
   * that if the number ever collapses to nearly nothing somebody notices,
   * whether because the suites were fixed to run or because they were quietly
   * gutted.
   */
  it("reports how much coverage the absent fixtures cost", () => {
    expect(fixtureGatedTestCount()).toBe(7);
  });
});
