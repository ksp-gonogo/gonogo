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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = dirname(fileURLToPath(import.meta.url));

/** Reaching outside this package: shelling out to git, or resolving up past it. */
const REACHES_OUT = [
  /execFileSync|execSync|spawnSync/, // git grep / git ls-files
  /SCAN_ROOTS/, // the shared scan-root convention
  /\.\.\/\.\.\/\.\.\//, // resolved up out of packages/core/src
  /TURBO_ROOT/,
  // Graded against a base revision, so it shells out to git through a helper
  // rather than in its own source. `uplink-isolation` and `typecheck-coverage`
  // read the whole tree that way and matched none of the patterns above: they
  // ran under `test`, which neither carries the repo-wide cache key nor is
  // declared to see RATCHET_BASE_REF, so in CI they graded against the commit
  // under test and refused.
  /ratchetBaseRef/,
];

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
