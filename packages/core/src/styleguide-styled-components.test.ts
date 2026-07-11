import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: migrated widgets carry zero bespoke CSS — they
 * compose @ksp-gonogo/ui-kit primitives + layout + tokens instead of
 * styling themselves with styled-components directly. Ratchet-style —
 * every widget migration that drops a styled-components import lowers
 * the baseline, every commit that adds one back fails the build with a
 * clear pointer at the offender.
 *
 * The expected route off styled-components: swap the widget's local
 * styled() wrappers for packages/ui-kit primitives (Card, Stack, Grid,
 * Readout, StatusIndicator, ProgressBar, WidgetHeader, ...). See
 * local_docs/telemetry-mod/ui-kit-design.md for the component catalogue.
 *
 * packages/ui and packages/ui-kit are themselves allowed to depend on
 * styled-components — they're the styling layer everything else should
 * be composing instead.
 */

// Package roots to scan: the built-in widget library plus every mod's
// client bundle. Both are consumers of ui-kit, never the styling layer
// itself, so a styled-components import there is always bespoke CSS.
const COMPONENT_SCAN_ROOTS = ["packages/components/src"];
const MOD_CLIENT_SRC_SUFFIX = ["client", "src"];

// Current baseline. When a widget migration removes its last
// styled-components import, lower this number in the same commit.
// Locks in the KosScriptFrame and Scanning migrations.
const STYLED_COMPONENTS_IMPORT_BASELINE = 75;

const STYLED_IMPORT_RE = /(?:from\s+|require\()\s*["']styled-components["']/;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage")
      continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(name)) yield path;
  }
}

function findModClientSrcRoots(repoRoot: string): string[] {
  const modDir = join(repoRoot, "mod");
  if (!existsSync(modDir)) return [];
  return readdirSync(modDir)
    .map((name) => join(modDir, name, ...MOD_CLIENT_SRC_SUFFIX))
    .filter((path) => existsSync(path));
}

function collectOffenders(): { file: string; line: number }[] {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const offenders: { file: string; line: number }[] = [];
  const scanRoots = [
    ...COMPONENT_SCAN_ROOTS.map((r) => join(root, r)),
    ...findModClientSrcRoots(root),
  ];
  for (const abs of scanRoots) {
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = relative(root, file);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, i) => {
        if (STYLED_IMPORT_RE.test(text)) {
          offenders.push({ file: rel, line: i + 1 });
        }
      });
    }
  }
  return offenders;
}

describe("design-system: styled-components imports outside ui-kit", () => {
  it("does not exceed the ratchet baseline", () => {
    const offenders = collectOffenders();
    if (offenders.length > STYLED_COMPONENTS_IMPORT_BASELINE) {
      const newCount = offenders.length - STYLED_COMPONENTS_IMPORT_BASELINE;
      const sample = offenders
        .slice(-Math.min(10, newCount))
        .map((o) => `  ${o.file}:${o.line}`)
        .join("\n");
      throw new Error(
        `styled-components import count (${offenders.length}) exceeds baseline ` +
          `(${STYLED_COMPONENTS_IMPORT_BASELINE}) by ${newCount}.\n` +
          `Migrated widgets carry zero bespoke CSS — compose @ksp-gonogo/ui-kit ` +
          `primitives + layout + tokens instead. Recent offenders:\n${sample}`,
      );
    }
    if (offenders.length < STYLED_COMPONENTS_IMPORT_BASELINE) {
      console.warn(
        `[styleguide] styled-components baseline can be lowered: ` +
          `${STYLED_COMPONENTS_IMPORT_BASELINE} → ${offenders.length}. ` +
          `Update STYLED_COMPONENTS_IMPORT_BASELINE in packages/core/src/styleguide-styled-components.test.ts.`,
      );
    }
    expect(offenders.length).toBeLessThanOrEqual(
      STYLED_COMPONENTS_IMPORT_BASELINE,
    );
  });
});
