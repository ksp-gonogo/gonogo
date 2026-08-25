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
 * Enumerate git-TRACKED `.ts`/`.tsx` files under the scan roots. Deterministic
 * under concurrent `turbo test` load: a live filesystem walk races with the
 * `dist/` output and temp fixtures other packages write mid-run, so the count
 * flickers, while the git index does not move during a test run.
 *
 * The cost of that choice, written down because it WILL mislead somebody
 * probing this gate: an UNTRACKED file is invisible here. A new test carrying
 * the banned import passes until it is added to the index. Verifying this gate
 * therefore means `git add -N` on the planted violation first, and a probe that
 * skips that step reports the gate as blind when it is not. CI and the commit
 * hook both see the index, so the case that matters is covered.
 */
function scan(): { scanned: number; offenders: string[] } {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...SCAN_ROOTS], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => /\.tsx?$/.test(rel));
  const offenders: string[] = [];
  for (const rel of tracked) {
    let source: string;
    try {
      source = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (CLEANUP_IMPORT_RE.test(source)) offenders.push(rel);
  }
  return { scanned: tracked.length, offenders };
}

/**
 * One scan per file, shared by the two assertions below.
 *
 * Both of them need a real scan and neither may drop it, so the cost was paid
 * twice: two `git ls-files` invocations plus two passes of `readFileSync` over
 * every tracked source. That is nearly two thousand extra file reads, and under
 * the I/O contention of a whole package's tests running at once it was enough
 * to take the second call past the 30s timeout while the same test finished in
 * three seconds run on its own. Memoising changes what it costs, not what it
 * checks: the floor and the offender list are still read off a real walk.
 */
let memoisedScan: ReturnType<typeof scan> | undefined;
function scanOnce(): ReturnType<typeof scan> {
  memoisedScan ??= scan();
  return memoisedScan;
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
    const { scanned } = scanOnce();
    expect(scanned).toBeGreaterThanOrEqual(SCAN_FLOOR);
  });

  it("finds no test importing cleanup", () => {
    const { scanned, offenders } = scanOnce();
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
