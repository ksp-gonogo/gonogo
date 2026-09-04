// Which of core's test files reach OUTSIDE this package.
//
// core hosts a family of cross-package ratchets (the styleguide-* guards,
// uplink-boundary, vendor-name, fixture-gated-suites) that scan every tracked
// file in the repo. Their results depend on sources turbo's per-package cache
// cannot see, so they need a cache key covering the whole tree. The other ~118
// core test files do not, and keying the WHOLE suite on the whole tree made a
// change anywhere re-run all of it: 85.7s on every push, regardless of what was
// touched.
//
// The set is DERIVED, never hand-listed. A hand-list is exactly what lost
// entries three times before (see this package's turbo.json): a new scan is
// added, nobody remembers the list, and it replays a stale pass. Here a file
// declares itself by what it does, so a new scan is picked up the day it lands.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = dirname(fileURLToPath(import.meta.url));

/**
 * Reaching outside this package: shelling out to git, or resolving up past it.
 *
 * Derived beats hand-listed, but only for the spellings it knows. Nineteen
 * cross-package ratchets were in the wrong bucket on 2026-09-04 because they
 * find the repo root two ways this list did not name: `join(HERE, "..", "..",
 * "..")`, the segmented form of a path the string pattern below only matched
 * with a trailing slash, and a walk up to `pnpm-workspace.yaml`. Among them
 * were `styleguide-duplicate-primitives` (the guard that exists because two
 * copies of `Panel` drifted across 29 widgets), `styleguide-token-refs`,
 * `styleguide-wall-clock`, `truenow-allowlist` and `ci-mandatory-steps`.
 *
 * Measured, not inferred: with an added `Date.now()` in
 * `packages/components/src/Graph/index.tsx`, `@ksp-gonogo/core#test` hashed to
 * `2775c5c0d6d7e120` both before and after, while `#test:scans` moved
 * `18cd6e00` -> `4aca15e0`. A warm cache replays the pass, which is the
 * failure this whole split was built to prevent and had already produced three
 * times.
 *
 * `scan-project-membership.test.ts` grades this list from a second direction
 * and fails on any pattern that has stopped matching anything.
 */
const REACHES_OUT = [
  /execFileSync|execSync|spawnSync/, // git grep / git ls-files
  /SCAN_ROOTS/, // the shared scan-root convention
  /styleguideScanRoots/, // and its lower-camel export, which the above misses
  /\.\.\/\.\.\/\.\./, // resolved up out of packages/core/src
  /join\([^)]*"\.\.",\s*"\.\.",\s*"\.\."/, // the same, spelled in segments
  /pnpm-workspace\.yaml/, // walked up to the workspace root
  /TURBO_ROOT/,
  // Graded against a base revision, so it shells out to git through a helper
  // rather than in its own source. `uplink-isolation` and `typecheck-coverage`
  // read the whole tree that way and matched none of the patterns above: they
  // ran under `test`, which neither carries the repo-wide cache key nor is
  // declared to see RATCHET_BASE_REF, so in CI they graded against the commit
  // under test and refused.
  /ratchetBaseRef/,
];

/** The patterns themselves, so a guard can ask whether each still matches. */
export const reachesOutPatterns = () => [...REACHES_OUT];

/**
 * Patterns kept despite having no subject in the tree, each with the reason.
 *
 * `scan-project-membership.test.ts` fails on a pattern that matches nothing,
 * because a pattern that stopped matching moves every test that used it into
 * the wrong project silently. That grading needs somewhere to put a pattern
 * that never had a subject, and the alternative was to delete it, which is a
 * loosening bought to quieten a guard.
 *
 * ONE entry. It is not a place to send a pattern that has gone quiet: that is
 * the failure the check exists to report.
 */
export const SPECULATIVE_PATTERNS = {
  TURBO_ROOT:
    "turbo.json's own `$TURBO_ROOT$` interpolation, which no test file has ever contained (checked with `git log -S` over the whole history of packages/core/src). Kept because a test that did read it would be reaching out by definition, and the cost of keeping it is nil.",
};

export function scanTestFiles() {
  // List everything tracked under src and filter in JS: git pathspec globbing
  // does not treat `**` the way a shell does without `:(glob)`, and a pattern
  // that silently matches nothing is how this set would lose entries again.
  const listed = execFileSync("git", ["ls-files", "src"], {
    cwd: CORE,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.test\.tsx?$/.test(f));
  if (listed.length === 0) {
    throw new Error(
      "scan-tests: git ls-files matched no test files under packages/core/src",
    );
  }
  return listed.filter((rel) => {
    const source = readFileSync(join(CORE, rel), "utf8");
    return REACHES_OUT.some((re) => re.test(source));
  });
}

/** Vitest glob form, relative to packages/core. */
export const scanGlobs = () => scanTestFiles();
