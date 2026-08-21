// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching
// `uplink-isolation.test.ts`: the shrink-only check transpiles the allowlist at
// a git ref through esbuild, which asserts a real TextEncoder/Uint8Array realm,
// and the scan asks `ts.sys` to resolve config files off disk.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { TYPECHECK_COVERAGE_DEBT } from "./typecheck-coverage.allowlist";

/**
 * Typecheck-coverage ratchet: a package's `typecheck` script must actually
 * typecheck that package's test files.
 *
 * `packages/core/tsconfig.json` carried `"exclude": ["src/**\/*.test.ts", …]`
 * and was also the config `typecheck` ran, so no core test file had ever been
 * type checked. Roughly forty architectural gates live in those files: the ones
 * enforcing our rules were the ones with no type checking. Including them
 * produced 103 errors.
 *
 * The exclusion was one line and nothing said it was there, which is the whole
 * point: a comment cannot fix an invisible gap, only a check that fails can.
 *
 * WHY IT ASKS THE COMPILER. The gate does not read `include`/`exclude` and
 * decide for itself what they mean. It hands the config to TypeScript's own
 * config parser and reads back the resolved file list, so a package that
 * arrives at the exclusion some other way (a narrowed `include`, an inherited
 * `exclude`, a `files` array) is caught by the same test. Re-implementing the
 * glob semantics would produce a scanner that answers a question adjacent to
 * the real one.
 *
 * The debt list and the reasoning live in `typecheck-coverage.allowlist.ts`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const BASE_REF = process.env.RATCHET_BASE_REF ?? "origin/staging";
const ALLOWLIST_PATH = "packages/core/src/typecheck-coverage.allowlist.ts";

/** Roots holding workspace packages. */
const PACKAGE_ROOTS = ["packages", "mod"];

/**
 * Floor for the self-check below. The repo had 24 packages carrying a
 * `typecheck` script when this landed; well under twenty means the walk lost
 * its input rather than the repo shrinking by half.
 */
const MIN_PACKAGES_SCANNED = 18;

const isTestFile = (f: string) => /\.test\.tsx?$/.test(f);

interface WorkspacePackage {
  /** Workspace-relative directory, POSIX separators. */
  dir: string;
  name: string;
  typecheckScript: string | undefined;
  testFiles: number;
}

function walkForPackages(absRoot: string, out: string[], depth = 0): void {
  if (depth > 3 || !existsSync(absRoot)) return;
  for (const entry of readdirSync(absRoot)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith("."))
      continue;
    const abs = join(absRoot, entry);
    if (!statSync(abs).isDirectory()) continue;
    if (existsSync(join(abs, "package.json"))) out.push(abs);
    walkForPackages(abs, out, depth + 1);
  }
}

function countTestFiles(absPkgDir: string): number {
  let count = 0;
  const stack = [absPkgDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) stack.push(abs);
      else if (isTestFile(entry)) count++;
    }
  }
  return count;
}

function discoverPackages(): WorkspacePackage[] {
  const dirs: string[] = [];
  for (const root of PACKAGE_ROOTS)
    walkForPackages(join(REPO_ROOT, root), dirs);
  return dirs
    .map((abs) => {
      const manifest = JSON.parse(
        readFileSync(join(abs, "package.json"), "utf8"),
      ) as { name?: string; scripts?: Record<string, string> };
      return {
        dir: relative(REPO_ROOT, abs).split(sep).join("/"),
        name: manifest.name ?? "(unnamed)",
        typecheckScript: manifest.scripts?.typecheck,
        testFiles: countTestFiles(abs),
      };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * The tsconfig paths a `typecheck` script actually runs, workspace-relative.
 *
 * A bare `tsc --noEmit` resolves the nearest `tsconfig.json`, which for a
 * package script is its own; `tsc -p X` names one outright. A script may chain
 * several with `&&`, and every one of them counts, because a package is covered
 * if ANY config in its typecheck run pulls the tests in.
 */
function configsFor(pkg: WorkspacePackage): string[] {
  if (pkg.typecheckScript === undefined) return [];
  const configs: string[] = [];
  for (const invocation of pkg.typecheckScript.matchAll(/tsc\s+([^&|;]*)/g)) {
    const explicit = invocation[1]?.match(/-p\s+(\S+)/);
    configs.push(`${pkg.dir}/${explicit ? explicit[1] : "tsconfig.json"}`);
  }
  return configs;
}

/**
 * Whether a tsconfig's resolved input contains any test file.
 *
 * `ts.getParsedCommandLineOfConfigFile` is the compiler's own resolution of
 * `extends` / `include` / `exclude` / `files`, so this answers the question the
 * build answers rather than a re-derivation of it. `undefined` means the config
 * would not parse at all, which the caller grades as a failure rather than as
 * an absence of coverage.
 */
function resolvedInputHasTests(absConfigPath: string): boolean | undefined {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    absConfigPath,
    /* optionsToExtend */ {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    } as ts.ParseConfigFileHost,
  );
  if (!parsed) return undefined;
  return parsed.fileNames.some((f) => isTestFile(f));
}

interface Coverage {
  pkg: WorkspacePackage;
  configs: string[];
  /** True when at least one config in the typecheck run resolves a test file. */
  covered: boolean;
  /** Configs named by the script that are not on disk. */
  missingConfigs: string[];
}

function measureCoverage(): Coverage[] {
  return discoverPackages()
    .filter((pkg) => pkg.testFiles > 0)
    .map((pkg) => {
      const configs = configsFor(pkg);
      const missingConfigs: string[] = [];
      let covered = false;
      for (const rel of configs) {
        const abs = join(REPO_ROOT, rel);
        if (!existsSync(abs)) {
          missingConfigs.push(rel);
          continue;
        }
        if (resolvedInputHasTests(abs) === true) covered = true;
      }
      return { pkg, configs, covered, missingConfigs };
    });
}

const COVERAGE = measureCoverage();

describe("typecheck coverage: every package typechecks its own test files", () => {
  it("actually scanned the tree", () => {
    // A walk that lost its root, or a manifest shape that moved, finds nothing
    // and reports a clean tree. Silence is indistinguishable from success, so
    // the input set is asserted before anything is concluded from it.
    expect(
      COVERAGE.length,
      `Only ${COVERAGE.length} packages with test files were found under ${PACKAGE_ROOTS.join(", ")}. The walk lost its input.`,
    ).toBeGreaterThanOrEqual(MIN_PACKAGES_SCANNED);

    const withoutConfigs = COVERAGE.filter((c) => c.configs.length === 0);
    expect(
      withoutConfigs.map((c) => c.pkg.dir),
      [
        "These packages ship test files but no `typecheck` script, so nothing",
        "type checks them at all. Add one; a package outside the scan is a",
        "package outside the rule.",
      ].join("\n"),
    ).toEqual([]);

    const missing = COVERAGE.flatMap((c) => c.missingConfigs);
    expect(
      missing,
      [
        "A `typecheck` script names a tsconfig that is not on disk. Either the",
        "script is wrong or this gate parsed it wrong; both make the coverage",
        "answer for that package meaningless.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("can see both answers (planted violation)", () => {
    // The dangerous failure mode is a detector that reports COVERED for a
    // config that excludes tests: it would have passed on the exact bug this
    // gate was written for. Both directions are planted, because a detector
    // stuck on either answer is blind, and neither is visible from the other.
    const scratch = mkdtempSync(join(tmpdir(), "typecheck-coverage-"));
    try {
      writeFileSync(join(scratch, "thing.ts"), "export const a = 1;\n");
      writeFileSync(join(scratch, "thing.test.ts"), "export const b = 1;\n");

      const including = join(scratch, "tsconfig.including.json");
      writeFileSync(including, JSON.stringify({ include: ["."] }));
      expect(
        resolvedInputHasTests(including),
        "BLIND: a config that plainly includes a .test.ts was not seen to include it.",
      ).toBe(true);

      const excluding = join(scratch, "tsconfig.excluding.json");
      writeFileSync(
        excluding,
        JSON.stringify({ include: ["."], exclude: ["**/*.test.ts"] }),
      );
      expect(
        resolvedInputHasTests(excluding),
        "BLIND: the planted exclusion was not seen. This gate cannot detect the defect it exists for.",
      ).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("no package excludes its test files unless it is on the debt list", () => {
    const offenders = COVERAGE.filter(
      (c) => !c.covered && !(c.pkg.dir in TYPECHECK_COVERAGE_DEBT),
    ).map(
      (c) =>
        `${c.pkg.dir} (${c.pkg.testFiles} test files, via ${c.configs.join(" + ")})`,
    );

    expect(
      offenders,
      [
        "These packages run `typecheck` against a config that resolves none of",
        "their test files, so a type error in a test is invisible to the build.",
        "",
        "Fix it the way `packages/core` did: move the emit-only settings",
        "(outDir, rootDir, and the test exclusion) into `tsconfig.build.json`,",
        "point `build` at that, and leave `tsconfig.json` covering everything",
        "with `noEmit`.",
        "",
        "Do NOT add an entry to `typecheck-coverage.allowlist.ts`: that list is",
        "shrink-only and seeded with what already existed.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("has no stale debt entries", () => {
    const covered = new Set(
      COVERAGE.filter((c) => c.covered).map((c) => c.pkg.dir),
    );
    const known = new Set(COVERAGE.map((c) => c.pkg.dir));

    const nowCovered = Object.keys(TYPECHECK_COVERAGE_DEBT).filter((dir) =>
      covered.has(dir),
    );
    expect(
      nowCovered,
      [
        "These packages now typecheck their tests but are still listed as debt.",
        "Delete their lines from `typecheck-coverage.allowlist.ts` in the same",
        "commit that fixed them: an entry nobody has to remove is how a list",
        "becomes archaeology.",
      ].join("\n"),
    ).toEqual([]);

    const vanished = Object.keys(TYPECHECK_COVERAGE_DEBT).filter(
      (dir) => !known.has(dir),
    );
    expect(
      vanished,
      "These debt entries name a package that no longer exists or no longer has test files. Delete them.",
    ).toEqual([]);
  });

  it("every debt entry says what would let it leave", () => {
    // An unexplained entry is a regression with a hall pass: see the escape
    // hatch section of docs/ratchets.md.
    const unexplained = Object.entries(TYPECHECK_COVERAGE_DEBT)
      .filter(([, reason]) => reason.trim().length < 30)
      .map(([dir]) => dir);
    expect(
      unexplained,
      "Every debt entry needs a substantive note saying what would let it leave, not a placeholder.",
    ).toEqual([]);
  });

  describe("the debt list only ever shrinks", () => {
    /**
     * The debt list at `BASE_REF`, or `undefined` when there is no base (first
     * land, shallow clone, detached CI ref) and there is nothing to diff
     * against. Soft-pass in that case, same as the other shrink checks here.
     */
    function baseDebt(): Record<string, string> | undefined {
      let source: string;
      try {
        source = execFileSync(
          "git",
          ["show", `${BASE_REF}:${ALLOWLIST_PATH}`],
          {
            cwd: REPO_ROOT,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch {
        return undefined;
      }
      const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
      const module_ = { exports: {} as Record<string, unknown> };
      new Function("module", "exports", js)(module_, module_.exports);
      return module_.exports.TYPECHECK_COVERAGE_DEBT as
        | Record<string, string>
        | undefined;
    }

    it("gains no entry vs the base ref", () => {
      const base = baseDebt();
      if (!base) {
        // Absent at base: the list was seeded after BASE_REF, so there is
        // nothing to grade and every entry is the seed.
        expect(true).toBe(true);
        return;
      }
      const added = Object.keys(TYPECHECK_COVERAGE_DEBT).filter(
        (dir) => !(dir in base),
      );
      expect(
        added,
        `Debt entries may only be REMOVED, never added, vs ${BASE_REF}. A package that newly excludes its tests is the regression this gate exists to stop.`,
      ).toEqual([]);
    });
  });
});
