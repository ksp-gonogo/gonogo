import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  reachesOutPatterns,
  SPECULATIVE_PATTERNS,
  scanTestFiles,
} from "../scan-tests.mjs";

/**
 * Which vitest project a core test lands in, and why getting it wrong is
 * silent.
 *
 * `packages/core` runs two projects. `test` is keyed on core's own sources like
 * any other package; `test:scans` carries a cache key over the whole tree,
 * because the ratchets in it read files turbo's per-package cache cannot see. A
 * cross-package ratchet that lands in `test` therefore replays a cached PASS
 * after a change to the very files it exists to inspect, and the run is green
 * for the same reason it would be green on a clean tree.
 *
 * On 2026-09-04 nineteen of them were in that state. Planting a `Date.now()` in
 * `packages/components/src/Graph/index.tsx` left `@ksp-gonogo/core#test` hashing
 * to `2775c5c0d6d7e120`, unchanged, while `#test:scans` moved from `18cd6e00` to
 * `4aca15e0`: the gate that catches that read was in the task whose key could
 * not see it.
 *
 * `scan-tests.mjs` derives membership rather than listing it, which is right and
 * is not sufficient on its own: a derivation only sees the spellings it knows,
 * and under-matching produces a shorter list rather than an error. So this file
 * grades the derivation two ways.
 *
 * It lists tracked files through `git ls-files`, the same call the derivation
 * makes, so the two cannot disagree about what a test file is. That also puts
 * this file in `test:scans` by its own rule, which is the honest place for it:
 * `git ls-files` reads the index, not this package.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..");

function coreTestFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], {
    cwd: CORE,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.test\.tsx?$/.test(f));
}

const files = coreTestFiles();
const sources = new Map(
  files.map((f) => [f, readFileSync(join(CORE, f), "utf8")] as const),
);
const inScans = new Set<string>(scanTestFiles());

describe("scans-project membership", () => {
  it("read core's test files at all", () => {
    // The instrument, before anything that could pass by finding nothing: a
    // `git ls-files` that returns nothing makes every check below vacuous.
    expect(files.length).toBeGreaterThan(80);
    expect(inScans.size).toBeGreaterThan(40);
  });

  /**
   * A pattern that has stopped matching anything is indistinguishable from one
   * whose subject has gone away, and both shrink the scans project silently.
   * `SCAN_ROOTS` is the live example of how close this runs: the shared helper
   * is exported as `styleguideScanRoots`, and only the upper-case constants
   * that four files happen to declare keep that pattern alive at all.
   */
  it("has no dead pattern in REACHES_OUT", () => {
    const speculative = Object.keys(SPECULATIVE_PATTERNS);
    const dead = reachesOutPatterns()
      .filter((re) => ![...sources.values()].some((s) => re.test(s)))
      .map((re) => re.source)
      .filter((source) => !speculative.includes(source));
    expect(
      dead,
      [
        "A REACHES_OUT pattern in packages/core/scan-tests.mjs matches no test",
        "file. Either the idiom it names was renamed, in which case every test",
        "that used it has quietly moved to the wrong vitest project, or the",
        "pattern was always wrong. A derivation that under-matches returns a",
        "shorter list, never an error.",
        "",
        "SPECULATIVE_PATTERNS is for a pattern that never had a subject, not",
        "for one that has gone quiet. A pattern reaching this failure has gone",
        "quiet, and the tests that used it are now in the `test` project where",
        "a cached pass can replay over the files they read.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The other half of that exemption: an entry naming a pattern that is no
   * longer in the list, or one that has since found a subject, both leave a
   * standing excuse behind for the next pattern that goes quiet.
   */
  it("lists no speculative pattern that is live or gone", () => {
    const live = new Set(
      reachesOutPatterns()
        .filter((re) => [...sources.values()].some((s) => re.test(s)))
        .map((re) => re.source),
    );
    const present = new Set(reachesOutPatterns().map((re) => re.source));
    const stale = Object.keys(SPECULATIVE_PATTERNS).filter(
      (source) => live.has(source) || !present.has(source),
    );
    expect(
      stale,
      "A SPECULATIVE_PATTERNS entry now matches something, or names a pattern that is no longer in REACHES_OUT. Delete the entry.",
    ).toEqual([]);
  });

  /**
   * The second direction, asked in a different shape on purpose. `REACHES_OUT`
   * asks HOW a file finds the repo root; this asks WHAT paths it names. A
   * renamed root helper breaks the first and not the second, which is exactly
   * the drift that put nineteen ratchets in the wrong project.
   */
  it("puts every test that names a path outside this package in test:scans", () => {
    const NAMES_OUTSIDE = [
      /["'`]packages\/(?!core\b)[a-z-]+\//,
      /["'`]mod\//,
      /["'`]docs\//,
      /["'`]scripts\//,
      /["'`]\.github\//,
    ];
    const misfiled = files
      .filter((f) => !inScans.has(f))
      .filter((f) => NAMES_OUTSIDE.some((re) => re.test(sources.get(f) ?? "")));
    expect(
      misfiled,
      [
        "A core test names a path outside packages/core but runs in the `test`",
        "project, whose turbo cache key covers only this package.",
        "",
        "It will replay a cached PASS after a change to the files it reads, and",
        "a replayed pass looks exactly like a real one. Teach",
        "packages/core/scan-tests.mjs the idiom this file uses to reach out;",
        "do not list the file by hand, and do not stop it reaching out to make",
        "this go quiet.",
      ].join("\n"),
    ).toEqual([]);
  });
});
