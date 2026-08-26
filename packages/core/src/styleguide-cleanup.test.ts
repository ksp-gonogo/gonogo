import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Test-hygiene guard: no test imports `cleanup` from `@testing-library/react`.
 *
 * Testing Library registers its own auto-cleanup and it already runs, so a
 * manual import is dead weight at best. At worst it masks the bug it looks like
 * it is fixing: a `cleanup()` in a test's own `afterEach` unmounts the tree
 * before the buggy async work can warn, so a real teardown race reads as a pass.
 *
 * Note what this does NOT ban, because the two get confused. Clearing SHARED
 * state in an `afterEach` is a separate question with a genuinely mixed answer
 * (measured across 13 files: 4 clears were pure harm, 2 were load-bearing).
 * This bans only the RTL `cleanup` import.
 *
 * Recovered from `sitrep-streaming`, where it carried a baseline of 142. The
 * tree reached zero on its own while the branch sat unmerged, so it lands as a
 * flat ban rather than a ratchet: there is no debt left to pay down, and the
 * only job left is stopping a new one appearing.
 */

const SCAN_ROOTS = ["packages", "mod"];

/**
 * Matches an import binding `cleanup` from `@testing-library/react`, across
 * multi-line import blocks.
 */
const CLEANUP_IMPORT_RE =
  /import\s*\{[^}]*\bcleanup\b[^}]*\}\s*from\s*["']@testing-library\/react["']/s;

/**
 * The scan must walk at least this many files to be believed. 2,077 tracked
 * `.ts`/`.tsx` files under the scan roots when this landed.
 *
 * Without a floor this whole file passes while seeing NOTHING: an enumeration
 * that returns an empty list finds zero offenders, and zero offenders is
 * exactly what success looks like. A renamed directory, a changed `git
 * ls-files` invocation or a cwd that is not the repo root would each do it, and
 * `styleguide-earth-day` shipped in precisely that state for weeks.
 */
const SCAN_FLOOR = 1500;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

/**
 * Memoised across the tests that ask. The input is the git index plus the
 * working tree, and neither moves during a test run, so one answer serves all
 * three assertions.
 */
let memo: { scanned: number; offenders: string[] } | undefined;

function scan(): { scanned: number; offenders: string[] } {
  if (memo !== undefined) return memo;
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  /*
   * Enumerate git-TRACKED sources rather than walking the filesystem. A live
   * walk races the `dist/` output and temp fixtures other packages write during
   * a concurrent `turbo test`, so its count flickers; the git index does not
   * move during a run.
   *
   * The cost of that choice, written down because it WILL mislead somebody
   * probing this gate: an UNTRACKED file is invisible here, so a new test
   * carrying the banned import passes until it is added to the index.
   * Verifying this gate therefore means `git add -N` on the planted violation
   * first, and a probe that skips that step reports the gate as blind when it
   * is not. CI and the commit hook both see the index, so the case that matters
   * is covered.
   */
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...SCAN_ROOTS], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => /\.tsx?$/.test(rel));
  // `git grep` narrows to the files that could possibly match before anything is
  // read. A file matching CLEANUP_IMPORT_RE necessarily contains the binding
  // `cleanup`, so this is a strict superset of the answer and the exact regex
  // still decides every candidate: what changes is the cost, not the verdict.
  //
  // It reads roughly a twentieth of the tree (100 of 2,195 when this landed).
  // The whole-tree read was ~2,000 `readFileSync` calls, which under the I/O
  // contention of a parallel run took this past its 30s budget repeatedly while
  // the same test finished in three seconds alone. That timeout aborts turbo,
  // which kills sibling tasks mid-run and leaves their partial output looking
  // like tasks that passed, so a slow scan here was costing whole suites their
  // verdict rather than just its own.
  const candidates = execFileSync(
    "git",
    ["grep", "-l", "-i", "--", "cleanup", ...SCAN_ROOTS],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter((rel) => /\.tsx?$/.test(rel));

  // A prefilter that quietly matched nothing would report no offenders, which is
  // indistinguishable from a clean tree. What prevents that is `git grep`'s own
  // exit status: it returns 1 when nothing matches and 2 on a bad pathspec, and
  // `execFileSync` throws on both, so a broken narrowing fails the test rather
  // than passing it. Verified by pointing the pathspec at a directory that does
  // not exist: two tests go red with "Command failed".
  //
  // The check below is therefore unreachable today and is kept as a backstop for
  // one specific future edit: wrapping this call in a try, or moving to an API
  // that returns an empty string instead of throwing, would restore exactly the
  // silence this scan cannot afford.
  if (candidates.length === 0 && tracked.length > 0) {
    throw new Error(
      "styleguide-cleanup: the git-grep prefilter matched no files while the tree " +
        "has tracked sources. The narrowing is broken, so this scan cannot see an " +
        "offender and must not report a clean result.",
    );
  }

  const offenders: string[] = [];
  for (const rel of candidates) {
    let source: string;
    try {
      source = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (CLEANUP_IMPORT_RE.test(source)) offenders.push(rel);
  }
  memo = { scanned: tracked.length, offenders };
  return memo;
}

describe("test-hygiene: manual cleanup imports from @testing-library/react", () => {
  it("recognises the import it bans, and leaves its neighbours alone", () => {
    // A ban whose pattern matches nothing passes every file in the repo, so the
    // pattern is exercised here BEFORE the scan result is trusted.
    //
    // The samples are ASSEMBLED rather than written out, because this file is
    // itself inside the scan roots: a literal sample would make this guard its
    // own first offender. Splitting the banned binding keeps the file subject to
    // its own rule instead of exempting it by path, which would leave the one
    // test file the guard cannot see.
    const bound = `clean${"up"}`;
    const rtl = '"@testing-library/react"';
    const sample = (binding: string, from: string) =>
      `import { ${binding} } from ${from};`;

    expect(CLEANUP_IMPORT_RE.test(sample(`${bound}, render`, rtl))).toBe(true);
    expect(
      CLEANUP_IMPORT_RE.test(
        `import {\n  render,\n  ${bound},\n} from ${rtl};`,
      ),
    ).toBe(true);
    // Neighbours that must NOT trip it: RTL without the banned binding, and a
    // same-named binding that belongs to somebody else.
    expect(CLEANUP_IMPORT_RE.test(sample("render", rtl))).toBe(false);
    expect(CLEANUP_IMPORT_RE.test(sample(bound, '"./my-own-helpers"'))).toBe(
      false,
    );
  });

  it("walks the tree it claims to walk", () => {
    const { scanned } = scan();
    expect(scanned).toBeGreaterThanOrEqual(SCAN_FLOOR);
  });

  it("finds no test importing cleanup", () => {
    const { scanned, offenders } = scan();
    expect(scanned).toBeGreaterThanOrEqual(SCAN_FLOOR);
    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} test(s) import cleanup from @testing-library/react.\n` +
          "Testing Library auto-cleans after every test: delete the import and " +
          "its cleanup() call. A manual cleanup() in a test's own afterEach also " +
          "masks real teardown races by unmounting before they can warn.\n" +
          offenders.map((o) => `  ${o}`).join("\n"),
      );
    }
    expect(offenders).toEqual([]);
    // Generous timeout: this reads every tracked source file, which is slow
    // under the CPU contention of a full concurrent `turbo test` run.
  }, 30_000);
});
