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
 * Readout, StatusIndicator, ProgressBar, WidgetHeader, ...). See
 * local_docs/telemetry-mod/ui-kit-design.md for the component catalogue.
 *
 * packages/ui and packages/ui-kit are themselves allowed to depend on
 * styled-components: they're the styling layer everything else should
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
//
// What remains is bespoke widget CSS, the test-infrastructure imports are
// gone. Snapshot tests, the `widgetDomSnapshot.tsx` harness, and the local
// `testTheme.tsx` helpers each used to pair `ThemeProvider` (from
// styled-components) with `defaultDarkTheme` themselves, which the scan root
// can't tell apart from a widget's own CSS. They now render through
// `DefaultThemeProvider` from `@ksp-gonogo/ui-kit` (the styling layer, which
// the scan excludes), so none of them import styled-components at all.
//
// 72 -> 74 when a camera Uplink's client half moved out of `packages/` (never
// scanned) and into `mod/<uplink>/client` (scanned, being a mod client
// bundle). Both added lines are SCOPE, not new bespoke CSS:
//   • its settings panel: untouched pre-existing code the scan simply reaches
//     now. A genuine migration candidate, newly visible rather than newly bad.
//   • its docking-camera augment: the SAME styled `<video>` backdrop that
//     used to live in Targeting as `HudVideo`, deleted from there in
//     the same commit. The app's bespoke CSS did not grow; it moved into the
//     Uplink that owns it. It reads as +1 only because Targeting still
//     imports styled-components for its other styled parts, so no line came
//     off that side of the ledger.
// Held at styled-components rather than respelt as inline styles: a sibling
// Uplink client's overlay augment styles the same way, and dodging a ratchet
// with a different CSS-in-JS spelling would defeat the point of having one.
// 74 -> 71: the baseline was carrying stale slack, not tracking a change.
// Counting importers under the scanned roots at d60b924e (the commit before
// the token migration) gives 71, the same as today, so three widgets dropped
// their last styled-components import at some earlier point and the number
// was never lowered. The ratchet had been printing its "can be lowered" nag
// for that whole time.
// 71 -> 41: the same staleness again, and thirty deep. Growth throws; shrinkage
// only warns, into a stream vitest suppresses for a passing test, so the nag
// above was printed on every green run for as long as it took thirty imports to
// disappear and nobody heard it. A baseline thirty above its live count is
// permission for thirty new ones, which is a gate that has stopped gating while
// still reporting green. Measured 41 lines in 41 files across 787 scanned files.
const STYLED_COMPONENTS_IMPORT_BASELINE = 41;

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
          `Migrated widgets carry zero bespoke CSS: compose @ksp-gonogo/ui-kit ` +
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
    // Generous timeout: this scans every tracked source file, which is slow
    // under the CPU contention of a full concurrent `turbo test` run.
  }, 30_000);
});
