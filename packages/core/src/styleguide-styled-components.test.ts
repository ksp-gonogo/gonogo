import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
// Locks in the KosScriptFrame and Scanning migrations, plus the
// `widgetDomSnapshot.tsx` test harness's `ThemeProvider` import (test
// infrastructure, not a widget — but the scan root doesn't distinguish).
//
// The five imports above 77 are `import { ThemeProvider } from
// "styled-components"` in snapshot TEST files (LandingStatus/LaunchDirector/
// MapView/Navball/Objectives `snapshots*.test.tsx` + the GonogoScansatUplink
// ScienceAugment slot test) — each wraps its render in
// `<ThemeProvider theme={defaultDarkTheme}>` for a themed snapshot. That's
// test infra, not bespoke widget CSS; the scan root can't distinguish a
// `.test.tsx` from a widget, so they land in the count. A shared
// render-with-theme helper would collapse them to one import, but the helper
// would live in the styling layer (`@ksp-gonogo/ui-kit`, unscanned) and every
// one of those test files would import it — so this baseline reflects the
// current state until that consolidation lands.
const STYLED_COMPONENTS_IMPORT_BASELINE = 82;

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

// Enumerate git-TRACKED files, not a live filesystem walk — the walk races
// with dist/ output and temp fixtures other packages write during a
// concurrent `turbo test`, making the count flicker; the git index is stable
// for the duration of a test run.
function collectOffenders(): { file: string; line: number }[] {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const tracked = execFileSync(
    "git",
    ["ls-files", "-z", "--", "packages/components/src", "mod"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(isScannedBundleFile);
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
    // Generous timeout: this scans every tracked source file, which is slow
    // under the CPU contention of a full concurrent `turbo test` run.
  }, 30_000);
});
