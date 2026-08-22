import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Coverage guard for the workspace's `*.test-d.ts` type-level assertions.
 *
 * A `.test-d.ts` file is never executed. vitest compiles through esbuild and
 * strips types without checking them, and every package's main `tsconfig.json`
 * excludes the `.test-d.ts` glob, so the ONLY thing that evaluates these
 * assertions is the per-package `tsc -p tsconfig.test-d.json` pass inside the
 * package's `typecheck` script, driven by `pnpm typecheck` in CI.
 *
 * That chain has three links, and a break in any of them is silent rather than
 * red. A file that no `tsconfig.test-d.json` include matches simply is not
 * compiled; a `typecheck` script that stops running the test-d config still
 * exits 0; a CI that stops running `pnpm typecheck` still passes. Measured: an
 * include glob pointed at a real source file instead of the `.test-d.ts` glob
 * exits 0 with a blatant `Expect<Equal<1, 2>>` sitting in the file. Only the
 * degenerate case where the include matches nothing at all is caught by tsc
 * itself, as TS18003.
 *
 * So this test walks the chain and fails on each break by name.
 */

const SCAN_ROOTS = ["packages", "mod"];

// The type-level assertion files as of this guard landing. A drop below this
// means files were deleted or the enumeration stopped matching, which is the
// failure mode the whole guard exists to catch: an enumeration that silently
// matches nothing reads as success. Raise it when type tests are added.
const TEST_D_FLOOR = 5;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

// git-tracked enumeration rather than a filesystem walk: a live walk races with
// the dist/ output other packages write during a concurrent `turbo test`.
function trackedTypeTests(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...SCAN_ROOTS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => rel.endsWith(".test-d.ts"));
}

/** Nearest ancestor directory holding a package.json, relative to the repo root. */
function owningPackage(relFile: string): string {
  let dir = dirname(relFile);
  while (dir !== "." && dir !== "/") {
    if (existsSync(join(ROOT, dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`No package.json above ${relFile}`);
}

/**
 * Minimal tsconfig include-glob matcher: `**` spans directories, `*` stays
 * within one segment, and an entry with no wildcard and no extension is a
 * directory prefix (tsconfig's own shorthand for "everything beneath").
 */
function includeMatches(pattern: string, path: string): boolean {
  const clean = pattern.replace(/^\.\//, "");
  if (!clean.includes("*") && !posix.basename(clean).includes(".")) {
    return path === clean || path.startsWith(`${clean}/`);
  }
  const source = clean
    .split("/")
    .map((segment) => {
      if (segment === "**") return "(?:.*)";
      return segment
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*");
    })
    .join("/")
    // `**/` should also match zero directories, which the literal join does not.
    .replace(/\(\?:\.\*\)\//g, "(?:.*/)?");
  return new RegExp(`^${source}$`).test(path);
}

function readIncludes(pkgDir: string): string[] {
  const raw = readFileSync(join(ROOT, pkgDir, "tsconfig.test-d.json"), "utf8");
  const parsed = JSON.parse(raw) as { include?: string[] };
  return parsed.include ?? [];
}

describe("type-level tests are actually gated", () => {
  it("enumerates the .test-d.ts files it claims to guard", () => {
    const files = trackedTypeTests();
    expect(
      files.length,
      `Found ${files.length} tracked *.test-d.ts files, floor is ${TEST_D_FLOOR}. ` +
        `A shrinking count means either the type tests were deleted or this ` +
        `enumeration stopped matching them. Lower TEST_D_FLOOR deliberately if ` +
        `the deletion was intended.`,
    ).toBeGreaterThanOrEqual(TEST_D_FLOOR);
  });

  it("compiles every .test-d.ts through its package's tsconfig.test-d.json", () => {
    const uncovered: string[] = [];
    for (const rel of trackedTypeTests()) {
      const pkgDir = owningPackage(rel);
      if (!existsSync(join(ROOT, pkgDir, "tsconfig.test-d.json"))) {
        uncovered.push(`${rel}: ${pkgDir} has no tsconfig.test-d.json`);
        continue;
      }
      const inPkg = relative(pkgDir, rel).split("\\").join("/");
      if (!readIncludes(pkgDir).some((p) => includeMatches(p, inPkg))) {
        uncovered.push(
          `${rel}: not matched by ${pkgDir}/tsconfig.test-d.json "include"`,
        );
      }
    }
    expect(
      uncovered,
      `These type-level assertion files are never compiled, so their ` +
        `assertions cannot fail:\n${uncovered.map((u) => `  ${u}`).join("\n")}`,
    ).toEqual([]);
  });

  it("runs tsconfig.test-d.json from each owning package's typecheck script", () => {
    const broken: string[] = [];
    const pkgDirs = [...new Set(trackedTypeTests().map(owningPackage))];
    for (const pkgDir of pkgDirs) {
      const pkg = JSON.parse(
        readFileSync(join(ROOT, pkgDir, "package.json"), "utf8"),
      ) as { name?: string; scripts?: Record<string, string> };
      const script = pkg.scripts?.typecheck;
      if (!script) {
        broken.push(`${pkgDir}: no "typecheck" script`);
      } else if (!script.includes("tsconfig.test-d.json")) {
        broken.push(
          `${pkgDir}: "typecheck" does not run tsconfig.test-d.json (${script})`,
        );
      }
    }
    expect(
      broken,
      `A package holding type-level assertions must run them from its ` +
        `typecheck script:\n${broken.map((b) => `  ${b}`).join("\n")}`,
    ).toEqual([]);
  });

  it("runs pnpm typecheck inside CI's test job", () => {
    const workflow = readFileSync(
      join(ROOT, ".github/workflows/ci.yml"),
      "utf8",
    );
    // Slice out the `test:` job body, from its key to the next job key at the
    // same indent, so the assertion cannot be satisfied by a `pnpm typecheck`
    // sitting in some other job that branch protection does not require.
    const start = /^ {2}test:$/m.exec(workflow);
    expect(start, "ci.yml has no `test:` job").not.toBeNull();
    const bodyFrom = (start?.index ?? 0) + (start?.[0].length ?? 0);
    const next = /^ {2}\S/m.exec(workflow.slice(bodyFrom));
    const job = workflow.slice(
      bodyFrom,
      next ? bodyFrom + next.index : workflow.length,
    );
    expect(
      /^\s*-\s*run: pnpm typecheck\s*$/m.test(job),
      `ci.yml's test job no longer runs "pnpm typecheck". Without it nothing ` +
        `in CI compiles the *.test-d.ts assertions, and they pass by never ` +
        `being read.`,
    ).toBe(true);
  });
});
