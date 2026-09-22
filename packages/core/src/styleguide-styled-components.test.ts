import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: migrated widgets carry zero bespoke CSS, they
 * compose @ksp-gonogo/ui-kit primitives + layout + tokens instead of
 * styling themselves with styled-components directly. Ratchet-style:
 * every widget migration that drops a styled-components import lowers
 * the baseline, every commit that adds one back fails the build with a
 * clear pointer at the offender.
 *
 * The expected route off styled-components: swap the widget's local
 * styled() wrappers for packages/ui-kit primitives (Card, Stack, Grid,
 * Readout, StatusIndicator, ProgressBar, WidgetHeader, ...).
 *
 * packages/ui and packages/ui-kit are themselves allowed to depend on
 * styled-components: they're the styling layer everything else should
 * be composing instead.
 *
 * The baseline is an EQUALITY: a migration that lowers the count fails this
 * test until the number below is lowered with it.
 */

// Package roots to scan: the built-in widget library plus every mod's
// client bundle. Both are consumers of ui-kit, never the styling layer
// itself, so a styled-components import there is always bespoke CSS.
const COMPONENT_SCAN_ROOTS = ["packages/components/src"];
const MOD_CLIENT_SRC_SUFFIX = ["client", "src"];

// Current baseline. When a widget migration removes its last
// styled-components import, lower this number in the same commit.
//
// Snapshot tests, the `widgetDomSnapshot.tsx` harness, and the local
// `testTheme.tsx` helpers render through `DefaultThemeProvider` from
// `@ksp-gonogo/ui-kit` (the styling layer, which the scan excludes), so none
// of them import styled-components.
//
// Held at styled-components rather than respelt as inline styles: dodging a
// ratchet with a different CSS-in-JS spelling would defeat the point of
// having one.
//
// A baseline sitting above its live count is permission for that many new
// imports, which is a gate that has stopped gating while still reporting
// green. Measured 38 lines in 38 files across 787 scanned files.
const STYLED_COMPONENTS_IMPORT_BASELINE = 38;

const STYLED_IMPORT_RE = /(?:from\s+|require\()\s*["']styled-components["']/;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

// A tracked .ts/.tsx file belongs to a widget/mod-client bundle (never the
// styling layer) if it sits under packages/components/src or any
// mod/<uplink>/client/src. dist/ output and packages/ui(-kit) are excluded.
function isScannedBundleFile(rel: string): boolean {
  if (!/\.tsx?$/.test(rel)) return false;
  if (COMPONENT_SCAN_ROOTS.some((r) => rel.startsWith(`${r}/`))) return true;
  const suffix = `/${MOD_CLIENT_SRC_SUFFIX.join("/")}/`;
  return rel.startsWith("mod/") && rel.includes(suffix);
}

// Enumerate git-TRACKED files, not a live filesystem walk, the walk races
// with dist/ output and temp fixtures other packages write during a
// concurrent `turbo test`, making the count flicker; the git index is stable
// for the duration of a test run.
function scannedFiles(root: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--", "packages/components/src", "mod"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(isScannedBundleFile);
}

function collectOffenders(): { file: string; line: number }[] {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const tracked = scannedFiles(root);
  const offenders: { file: string; line: number }[] = [];
  for (const rel of tracked) {
    let lines: string[];
    try {
      lines = readFileSync(join(root, rel), "utf8").split("\n");
    } catch {
      continue;
    }
    lines.forEach((text, i) => {
      if (STYLED_IMPORT_RE.test(text)) {
        offenders.push({ file: rel, line: i + 1 });
      }
    });
  }
  return offenders;
}

/**
 * Where the growth most likely is, for a gate that only knows a TOTAL.
 *
 * `offenders.slice(-newCount)` reads as "the newest ones" and is not: the
 * list is in scan order, so the tail is simply whatever sorts last, which can
 * name an innocent file instead of the real regression.
 *
 * A file holding TWO is the real signal, because the migrated tree has exactly
 * one import per importing file, so a second in one file is the shape almost
 * every regression takes. When the growth is instead a whole new file with one
 * import, no heuristic can find it from a total and the message says so rather
 * than guessing.
 */
function locateGrowth(offenders: { file: string; line: number }[]): string {
  const perFile = new Map<string, number[]>();
  for (const o of offenders) {
    perFile.set(o.file, [...(perFile.get(o.file) ?? []), o.line]);
  }
  const doubled = [...perFile]
    .filter(([, lines]) => lines.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(
      ([file, lines]) =>
        `  ${file}: ${lines.length} (lines ${lines.join(", ")})`,
    );
  return doubled.length > 0
    ? `Files importing it more than once, which is where growth usually is:\n${doubled.join("\n")}`
    : `Every importing file holds exactly one, so the added import is in a file ` +
        `that had none. \`git diff -S'styled-components'\` against the base names it.`;
}

/**
 * A guard on the guard, the two the sibling budgets
 * (`styleguide-magnitude-budget`, `styleguide-fire-and-forget-commands`) carry
 * and this one did not.
 *
 * A ratchet whose scan matches nothing counts zero and reads as a clean tree,
 * and this one is a whole baseline BELOW its recorded number rather than above
 * it, so a broken scan lands in the direction that passes. The two failure
 * modes are separate and neither implies the other: the file walk can stop
 * finding files (a moved root, a renamed extension), or the walk can be fine
 * and the regex stop matching. So one check per failure.
 *
 * Deliberately far under the ~780 files the walk currently reaches, so ordinary
 * churn never trips it and only a broken enumeration does.
 */
const MINIMUM_FILES_SCANNED = 300;

describe("design-system: styled-components imports outside ui-kit", () => {
  it("is actually looking at the codebase", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    expect(scannedFiles(root).length).toBeGreaterThanOrEqual(
      MINIMUM_FILES_SCANNED,
    );
  });

  it("can see a violation (planted)", () => {
    // The regex half. `git grep -E` has no `\b` and this one is a JS RegExp,
    // but the same class of silent-zero applies: a pattern edited to stop
    // matching reports a migrated tree rather than a broken check. Every
    // spelling here is one the scan is claimed to catch.
    for (const planted of [
      'import styled from "styled-components";',
      "import styled from 'styled-components';",
      'import styled, { css, keyframes } from "styled-components";',
      'const styled = require("styled-components");',
      'export { x } from "styled-components";',
    ]) {
      expect(STYLED_IMPORT_RE.test(planted)).toBe(true);
    }
    // And does not fire on prose about it, which is what a bare
    // /styled-components/ would have done to every comment in this file.
    for (const innocent of [
      "// migrated off styled-components in favour of ui-kit",
      'import { Stack } from "@ksp-gonogo/ui-kit";',
    ]) {
      expect(STYLED_IMPORT_RE.test(innocent)).toBe(false);
    }
  });

  it("matches the ratchet baseline exactly", () => {
    const offenders = collectOffenders();
    if (offenders.length > STYLED_COMPONENTS_IMPORT_BASELINE) {
      const newCount = offenders.length - STYLED_COMPONENTS_IMPORT_BASELINE;
      throw new Error(
        `styled-components import count (${offenders.length}) exceeds baseline ` +
          `(${STYLED_COMPONENTS_IMPORT_BASELINE}) by ${newCount}.\n` +
          `Migrated widgets carry zero bespoke CSS: compose @ksp-gonogo/ui-kit ` +
          `primitives + layout + tokens instead.\n${locateGrowth(offenders)}`,
      );
    }
    if (offenders.length < STYLED_COMPONENTS_IMPORT_BASELINE) {
      const slack = STYLED_COMPONENTS_IMPORT_BASELINE - offenders.length;
      throw new Error(
        `styled-components imports are down to ${offenders.length} and the ` +
          `baseline still reads ${STYLED_COMPONENTS_IMPORT_BASELINE}. Those ` +
          `${slack} of slack are permission for ${slack} new ones, which is why ` +
          `this fails instead of warning.\n` +
          `Set STYLED_COMPONENTS_IMPORT_BASELINE = ${offenders.length} in ` +
          `packages/core/src/styleguide-styled-components.test.ts, and add a ` +
          `line to the note above it saying which widget migrated.`,
      );
    }
    /*
     * The load-bearing line. Both arms above only phrase the failure better,
     * so neither needs a planted self-check the way the sibling per-file
     * budgets' shrink arms do: those compute a stale-entry list in a loop, and
     * a loop that stops comparing yields an empty list that passes. This
     * compares the two numbers with nothing in between.
     */
    expect(offenders.length).toBe(STYLED_COMPONENTS_IMPORT_BASELINE);
    // Generous timeout: this scans every tracked source file, which is slow
    // under the CPU contention of a full concurrent `turbo test` run.
  }, 30_000);
});
