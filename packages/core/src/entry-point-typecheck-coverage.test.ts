// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readJsonObject } from "./ratchetBaseRef";
import { tsconfigsRunBy } from "./typecheckScriptConfigs";

/**
 * Every render-harness or probe entry point must sit inside a tsconfig that
 * `pnpm typecheck` actually runs.
 *
 * Node realm rather than the package's jsdom default, matching
 * `typecheck-coverage.test.ts`: this asks `ts.sys` to resolve config files off
 * disk and shells out to git.
 *
 * Saga #295: three files using `Unit` or `Meter` sat in no package's tsconfig
 * at all (`components/tsconfig.json` and `ui-kit/tsconfig.json` covered `src`
 * only), so a fully green `pnpm typecheck` said nothing about them. Wiring
 * `ui-kit/scripts` into a project by hand, against an in-progress tree,
 * surfaced four real type errors that nothing anyone actually ran would have
 * shown. The ticket's own closing line ("the ratchet only grades files that
 * name `Unit` or `Meter`, so its list is a lower bound on the hole, not its
 * extent") proved itself within a day: a fourth file landed drawing `<Band>`
 * instead, unchecked and unlisted at the same time.
 *
 * `app`, `components` and `ui-kit` each now carry a `tsconfig.scripts.json`
 * wired into their `typecheck` script, closing the hole those four files sat
 * in. This is the gate that keeps a fifth one from landing the same way: it
 * grades every render-harness and probe entry point BY SHAPE (an
 * `*.entry.tsx` driver, a `scripts/probe/**` file, a `render-*` script),
 * never by which primitive it happens to draw, so the next hole does not need
 * its own ticket to be seen.
 *
 * WHY THE COMPILER'S OWN CONFIG PARSER: reading a tsconfig's `include` /
 * `exclude` by hand would answer a question adjacent to the real one: a
 * narrowed `include`, an inherited `exclude`, or a `files` array all reach
 * the same place a different way. This hands each config a `typecheck`
 * script names to `ts.getParsedCommandLineOfConfigFile` and asks the
 * resolved file list, exactly as `typecheck-coverage.test.ts` does for a
 * package's own test files.
 *
 * Scoped to `packages/*`: `mod/` builds through its own toolchain (a
 * separately-gated Uplink matrix) and carries no entry point of this shape
 * today; it is out of scope for this gate rather than silently included.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/**
 * A render harness or probe entry point, by shape rather than by name: an
 * `*.entry.tsx` driver, anything under a `scripts/probe/` directory, or a
 * `render-*` script. All three live under some package's `scripts/`, which
 * keeps an ordinary source file that merely starts with `render-` (this
 * package's own `render-fixture-coverage.ts`, in `src`) out of the count.
 */
function isEntryPointFile(relPath: string): boolean {
  if (!/\.tsx?$/.test(relPath)) return false;
  if (!/(^|\/)scripts\//.test(relPath)) return false;
  const basename = relPath.split("/").pop() ?? "";
  return (
    /\.entry\.tsx$/.test(basename) ||
    /^render-[^/]+\.tsx?$/.test(basename) ||
    /(^|\/)scripts\/probe\//.test(relPath)
  );
}

/** The nearest package directory that owns `relPath`, among `packageDirs`. */
function ownerOf(
  relPath: string,
  packageDirs: readonly string[],
): string | undefined {
  return packageDirs
    .filter((dir) => relPath.startsWith(`${dir}/`))
    .sort((a, b) => b.length - a.length)[0];
}

function typecheckScriptOf(
  repoRoot: string,
  pkgDir: string,
): string | undefined {
  const manifest = readJsonObject(join(repoRoot, pkgDir, "package.json"));
  const scripts: unknown = manifest.scripts;
  const script =
    typeof scripts === "object" && scripts !== null
      ? Reflect.get(scripts, "typecheck")
      : undefined;
  return typeof script === "string" ? script : undefined;
}

/** Every absolute path a tsconfig resolves to, or undefined if it will not parse. */
function resolvedFiles(absConfigPath: string): Set<string> | undefined {
  const parsed = ts.getParsedCommandLineOfConfigFile(absConfigPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  } as ts.ParseConfigFileHost);
  return parsed ? new Set(parsed.fileNames) : undefined;
}

interface Violation {
  file: string;
  reason: string;
}

/**
 * Every candidate that the owning package's `typecheck` script cannot reach.
 *
 * Takes an explicit candidate list and package-directory list rather than
 * discovering them itself, so the planted-violation test below can drive the
 * same function against a synthetic tree instead of a second, hand-copied
 * implementation of the rule.
 */
function uncoveredEntryPoints(
  repoRoot: string,
  candidates: readonly string[],
  packageDirs: readonly string[],
): Violation[] {
  const coverageByPkg = new Map<string, Set<string>>();
  const violations: Violation[] = [];

  for (const file of candidates) {
    const owner = ownerOf(file, packageDirs);
    if (owner === undefined) {
      violations.push({
        file,
        reason: "no package.json in packages/* owns this file",
      });
      continue;
    }
    let covered = coverageByPkg.get(owner);
    if (covered === undefined) {
      covered = new Set<string>();
      const script = typecheckScriptOf(repoRoot, owner);
      for (const rel of tsconfigsRunBy(owner, script)) {
        const rf = resolvedFiles(join(repoRoot, rel));
        if (rf) for (const abs of rf) covered.add(abs);
      }
      coverageByPkg.set(owner, covered);
    }
    if (!covered.has(join(repoRoot, file))) {
      const script = typecheckScriptOf(repoRoot, owner);
      violations.push({
        file,
        reason:
          script === undefined
            ? `${owner} has no "typecheck" script`
            : `${owner}'s typecheck script ("${script}") resolves no config that includes this file`,
      });
    }
  }
  return violations;
}

/** Every entry-point file `packages/*` tracks, workspace-relative. */
function trackedEntryPoints(repoRoot: string): string[] {
  return execFileSync("git", ["ls-files", "packages"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((rel) => rel.length > 0 && isEntryPointFile(rel));
}

function trackedPackageDirs(repoRoot: string): string[] {
  return execFileSync("git", ["ls-files", "packages"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((rel) => rel.endsWith("/package.json"))
    .map((rel) => rel.slice(0, -"/package.json".length));
}

describe("every render-harness and probe entry point typechecks", () => {
  it("actually scanned the tree", () => {
    /**
     * Silence is indistinguishable from success: a walk that lost its root or
     * whose patterns stopped matching anything reports the same empty, clean
     * list as a tree with nothing to find.
     */
    const candidates = trackedEntryPoints(REPO_ROOT);
    expect(
      candidates.length,
      "Found no render-harness or probe entry points at all under packages/*. " +
        "Either the patterns in isEntryPointFile stopped matching, or the git " +
        "walk lost its input; either way this is not evidence of a clean tree.",
    ).toBeGreaterThan(50);
  });

  it("no entry point lands outside a tsconfig `pnpm typecheck` runs", () => {
    const packageDirs = trackedPackageDirs(REPO_ROOT);
    const candidates = trackedEntryPoints(REPO_ROOT);
    const violations = uncoveredEntryPoints(REPO_ROOT, candidates, packageDirs);
    expect(
      violations.map((v) => `${v.file}: ${v.reason}`),
      [
        "These render-harness or probe entry points sit outside every tsconfig",
        "`pnpm typecheck` runs, so a type error in them is invisible to CI. Give",
        "the owning package a `tsconfig.scripts.json` (see `packages/ui-kit` or",
        "`packages/components` for the worked example) and wire it into that",
        "package's `typecheck` script.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("can see a planted violation, and stops seeing it once covered", () => {
    /**
     * The dangerous failure mode is a detector that reports COVERED for a
     * package whose config excludes the file: it would pass on the exact
     * hole this gate exists to close. Both directions are planted on a
     * synthetic package outside the real tree, so the plant cannot be
     * confused with the real tree's own (currently clean) state.
     */
    const scratch = mkdtempSync(join(tmpdir(), "entry-point-coverage-"));
    try {
      const pkgDir = join(scratch, "packages", "plantpkg");
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      mkdirSync(join(pkgDir, "scripts"), { recursive: true });
      writeFileSync(join(pkgDir, "src", "index.ts"), "export const a = 1;\n");
      writeFileSync(
        join(pkgDir, "scripts", "render-plant.ts"),
        "export const b = 1;\n",
      );
      writeFileSync(
        join(pkgDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: {}, include: ["src"] }),
      );
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "plant",
          scripts: { typecheck: "tsc --noEmit" },
        }),
      );

      const candidate = "packages/plantpkg/scripts/render-plant.ts";
      const packageDirs = ["packages/plantpkg"];

      const uncovered = uncoveredEntryPoints(scratch, [candidate], packageDirs);
      expect(
        uncovered.map((v) => v.file),
        "BLIND: a render-harness script outside its package's only tsconfig " +
          "was not seen. This gate cannot detect the defect it exists for.",
      ).toEqual([candidate]);

      // Cover it the way the real fix does: a scripts config wired in.
      writeFileSync(
        join(pkgDir, "tsconfig.scripts.json"),
        JSON.stringify({
          compilerOptions: { noEmit: true },
          include: ["scripts"],
        }),
      );
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "plant",
          scripts: {
            typecheck: "tsc --noEmit && tsc -p tsconfig.scripts.json",
          },
        }),
      );

      const nowCovered = uncoveredEntryPoints(
        scratch,
        [candidate],
        packageDirs,
      );
      expect(
        nowCovered,
        "The same file, now inside a config its typecheck script runs, was " +
          "still reported uncovered. This gate would never let a real fix pass.",
      ).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
