import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Test-hygiene guard: no test imports `cleanup` from @testing-library/react.
 * Testing Library unmounts every rendered tree in an automatic afterEach, so
 * a manual cleanup import (and the cleanup() call it enables) is dead weight —
 * and worse, a manual cleanup() in a test's own afterEach routinely masks a
 * real teardown bug by unmounting before the buggy async work can warn.
 *
 * Ratchet-style: every test that drops its cleanup import lowers the baseline;
 * any commit that adds one back fails the build with a pointer at the offender.
 * The route off cleanup is simply deleting the import and its cleanup() call —
 * automatic cleanup already covers it.
 */

// Every test across the workspace. cleanup is a test-only symbol, so there is
// no source dir to exempt — the ban is repo-wide.
const SCAN_ROOTS = ["packages", "mod"];

// Current baseline. Zero: every manual cleanup import has been removed from
// the tree, so the ratchet now holds the line at none. Any commit that adds
// one back fails the build with a pointer at the offender.
const CLEANUP_IMPORT_BASELINE = 0;

// Matches an import binding `cleanup` from @testing-library/react, across
// multi-line import blocks.
const CLEANUP_IMPORT_RE =
  /import\s*\{[^}]*\bcleanup\b[^}]*\}\s*from\s*["']@testing-library\/react["']/s;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

// Enumerate git-TRACKED .ts/.tsx files under the scan roots. Deterministic
// under concurrent `turbo test` load — a live filesystem walk races with the
// dist/ output and temp fixtures other packages write mid-run, so the count
// flickers; the git index does not move during a test run.
function collectOffenders(): string[] {
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
  return offenders;
}

describe("test-hygiene: manual cleanup imports from @testing-library/react", () => {
  it("does not exceed the ratchet baseline", () => {
    const offenders = collectOffenders();
    if (offenders.length > CLEANUP_IMPORT_BASELINE) {
      const newCount = offenders.length - CLEANUP_IMPORT_BASELINE;
      const sample = offenders
        .slice(-Math.min(10, newCount))
        .map((o) => `  ${o}`)
        .join("\n");
      throw new Error(
        `cleanup import count (${offenders.length}) exceeds baseline ` +
          `(${CLEANUP_IMPORT_BASELINE}) by ${newCount}.\n` +
          `Testing Library auto-cleans after every test — delete the cleanup ` +
          `import and its cleanup() call. Recent offenders:\n${sample}`,
      );
    }
    if (offenders.length < CLEANUP_IMPORT_BASELINE) {
      console.warn(
        `[styleguide] cleanup-import baseline can be lowered: ` +
          `${CLEANUP_IMPORT_BASELINE} → ${offenders.length}. ` +
          `Update CLEANUP_IMPORT_BASELINE in packages/core/src/styleguide-cleanup.test.ts.`,
      );
    }
    expect(offenders.length).toBeLessThanOrEqual(CLEANUP_IMPORT_BASELINE);
    // Generous timeout: this scans every tracked source file, which is slow
    // under the CPU contention of a full concurrent `turbo test` run.
  }, 30_000);
});
