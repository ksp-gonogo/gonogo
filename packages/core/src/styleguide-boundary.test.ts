// @vitest-environment node
//
// Filesystem scan (walks two package src trees); no DOM. Same node-env posture
// as uplink-boundary.test.ts, for the same reason.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ui-kit <-> spine boundary ratchet.
 *
 * ui-kit is the workspace's vanilla design floor: it may be imported by the
 * spine, never the reverse at runtime, and it must not reach back into the
 * spine at runtime either. The two directions:
 *
 *   1. `packages/ui-kit/src` must not RUNTIME-import a telemetry-spine package
 *      (`@ksp-gonogo/sitrep-client`, the app-side spine + hooks, or
 *      `@ksp-gonogo/sitrep-server`, the mod server). `import type` is allowed
 *      (erased at build, no runtime edge).
 *   2. `packages/sitrep-client/src` (production files, NOT tests) must not
 *      RUNTIME-import `@ksp-gonogo/ui-kit`. Tests may: ui-kit is a
 *      devDependency there, and a test legitimately renders real widgets.
 *      `import type` is allowed in production files too.
 *
 * NOT forbidden: ui-kit importing `@ksp-gonogo/sitrep-sdk` at runtime. The sdk
 * is the generated typed contract + unit system both ui-kit and the spine sit
 * ON (dependency direction sdk <- ui-kit, sdk <- sitrep-client), not the spine;
 * `kspTime`, `units`, `Unit`, `ControlDelayStream` and others depend on its
 * `value`/`calendarRatio`/`registerUnit` runtime helpers by design. Forbidding
 * it would red a boundary-clean tree.
 *
 * This is what v1 of the panel-header redesign broke: it made
 * `sitrep-client/src/use-command.ts` import `useDelayRailStore` from
 * `@ksp-gonogo/ui-kit` (direction 2) and added the runtime dep. The reworked
 * design contributes the delay handle through a ui-kit hook instead
 * (`usePanelDelay`, the `useStatusContribution` pattern), so nothing crosses
 * the boundary. The synthetic-fixtures test below proves the detector would
 * have failed on v1's exact import and passes on the reverted form.
 */

const SPINE_PACKAGES = [
  "@ksp-gonogo/sitrep-client",
  "@ksp-gonogo/sitrep-server",
];
const UI_KIT_PACKAGE = "@ksp-gonogo/ui-kit";

const SCAN_EXTENSIONS = /\.(tsx?)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "bin", "obj", "coverage"]);
// A production (non-test) file. Excludes vitest specs and tsd type tests.
const TEST_FILE = /\.(test|test-d|spec)\.tsx?$/;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SCAN_EXTENSIONS.test(name)) yield path;
  }
}

/**
 * True if `content` has a RUNTIME import (or re-export) of `pkg`. A
 * statement-level `import type` / `export type` is type-only and does NOT
 * count. The `import` must begin a line (after indentation), so a package
 * name mentioned inside a comment or string is not a false positive: a comment
 * line starts with `//` or `*`, never a bare `import`/`export` keyword. An
 * inline `import { type X }` is treated as runtime on purpose (the module is
 * still named in a value-import statement; use `import type` if it is truly
 * type-only).
 */
function hasRuntimeImport(content: string, pkg: string): boolean {
  const spec = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffix = `(?:/[^'"]*)?['"]`;
  const fromRe = new RegExp(
    `^[ \\t]*(?:import|export)\\s+(type\\s+)?[^;'"]*?from\\s*['"]${spec}${suffix}`,
    "gm",
  );
  let match: RegExpExecArray | null = fromRe.exec(content);
  while (match !== null) {
    if (!match[1]) return true; // no `type` keyword after import/export
    match = fromRe.exec(content);
  }
  // Side-effect import: `import "<pkg>"`, always runtime.
  const sideRe = new RegExp(`^[ \\t]*import\\s*['"]${spec}${suffix}`, "m");
  return sideRe.test(content);
}

/** Files (repo-relative) under `root` that runtime-import any package in `pkgs`. */
function violationsUnder(
  repoRoot: string,
  root: string,
  pkgs: string[],
  includeTests: boolean,
): string[] {
  const hits: string[] = [];
  for (const file of walk(join(repoRoot, root))) {
    const rel = relative(repoRoot, file);
    if (!includeTests && TEST_FILE.test(rel)) continue;
    const content = readFileSync(file, "utf8");
    if (pkgs.some((pkg) => hasRuntimeImport(content, pkg))) hits.push(rel);
  }
  return hits;
}

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Floors on the two scan roots, well under the 232 and 143 present when these
 * were written.
 *
 * `walk` returns nothing for a directory that is not there, and both gates pass
 * on an empty file list, so a package whose `src` moves takes its own boundary
 * gate with it and the result reads exactly like a clean tree. Both of these
 * packages have been reorganised before.
 */
const MIN_FILES_SCANNED: Record<string, number> = {
  "packages/ui-kit/src": 150,
  "packages/sitrep-client/src": 90,
};

describe("ui-kit <-> spine import boundary", () => {
  it.each(
    Object.entries(MIN_FILES_SCANNED),
  )("actually walks %s, so a clean result means something", (root, floor) => {
    const scanned = [...walk(join(REPO_ROOT, root))];
    expect(
      scanned.length,
      `Walked ${scanned.length} file(s) under ${root}, expected at least ${floor}. ` +
        "An empty walk reports the same empty violation list as a clean one.",
    ).toBeGreaterThanOrEqual(floor);
  });

  it("ui-kit/src does not runtime-import the telemetry spine", () => {
    // Includes ui-kit tests: ui-kit has no spine dependency at all, so no file
    // of any kind should reach the spine at runtime.
    const found = violationsUnder(
      REPO_ROOT,
      "packages/ui-kit/src",
      SPINE_PACKAGES,
      true,
    );
    if (found.length > 0) {
      throw new Error(
        `ui-kit/src runtime-imports a telemetry-spine package ` +
          `(${SPINE_PACKAGES.join(", ")}). ui-kit is the vanilla design floor: ` +
          `cross-boundary data enters as a structural value passed to a hook/prop ` +
          `(as the command handle does via usePanelDelay), never a spine import. ` +
          `Use \`import type\` if it is type-only:\n` +
          found.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(found).toEqual([]);
  });

  it("sitrep-client/src production files do not runtime-import ui-kit", () => {
    const found = violationsUnder(
      REPO_ROOT,
      "packages/sitrep-client/src",
      [UI_KIT_PACKAGE],
      false,
    );
    if (found.length > 0) {
      throw new Error(
        `sitrep-client/src runtime-imports ${UI_KIT_PACKAGE}. The spine never ` +
          `imports the design system: contribute to a ui-kit store from a ui-kit ` +
          `hook the widget calls (usePanelDelay / useStatusContribution) instead. ` +
          `Tests may import ui-kit (devDependency); production files may only ` +
          `\`import type\`:\n` +
          found.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(found).toEqual([]);
  });
});

describe("hasRuntimeImport: detector fixtures (the v1 regression + its allowed forms)", () => {
  it("flags v1's exact coupling: sitrep-client runtime-importing ui-kit", () => {
    const v1 = `import { useDelayRailStore } from "@ksp-gonogo/ui-kit";\n`;
    expect(hasRuntimeImport(v1, UI_KIT_PACKAGE)).toBe(true);
  });

  it("allows a statement-level type-only import of ui-kit", () => {
    const typed = `import type { CommandDelayHandle } from "@ksp-gonogo/ui-kit";\n`;
    expect(hasRuntimeImport(typed, UI_KIT_PACKAGE)).toBe(false);
  });

  it("does not treat the sdk as the spine: a runtime sdk import is not a spine import", () => {
    const sdk = `import { value } from "@ksp-gonogo/sitrep-sdk";\n`;
    for (const spine of SPINE_PACKAGES) {
      expect(hasRuntimeImport(sdk, spine)).toBe(false);
    }
  });

  it("flags a side-effect import of the spine", () => {
    const side = `import "@ksp-gonogo/sitrep-client";\n`;
    expect(hasRuntimeImport(side, "@ksp-gonogo/sitrep-client")).toBe(true);
  });

  it("flags a multi-line runtime import", () => {
    const multi = `import {\n  DelayRailContext,\n  useActiveHandles,\n} from "@ksp-gonogo/ui-kit";\n`;
    expect(hasRuntimeImport(multi, UI_KIT_PACKAGE)).toBe(true);
  });

  it("does not false-positive on a comment or prose mention of the package", () => {
    const prose = `// The type comes from the sdk rather than @ksp-gonogo/ui-kit.\n * see @ksp-gonogo/sitrep-client for the spine.\n`;
    expect(hasRuntimeImport(prose, UI_KIT_PACKAGE)).toBe(false);
    expect(hasRuntimeImport(prose, "@ksp-gonogo/sitrep-client")).toBe(false);
  });
});
