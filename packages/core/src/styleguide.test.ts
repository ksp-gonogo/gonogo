import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SCANNED_PACKAGE_ROOTS,
  styleguideScanRoots,
  UNSCANNED_PACKAGE_ROOTS,
} from "./styleguideScanRoots";

/**
 * Design-system guard: prevent new raw hex colour literals leaking into
 * the codebase. Ratchet-style: every refactor that drops the count
 * lowers the baseline, every commit that introduces new raw hex fails
 * the build with a clear pointer at the offender.
 *
 * The expected route to landing colours:
 *   1. Add the value to `packages/theme/src/tokens.css` as a `--color-*`
 *      token (or pick an existing one). It is the single source of
 *      truth: `packages/app/src/styles/global.css` only `@import`s it,
 *      and a separate ratchet (`tokenSingleSource.test.ts`) FORBIDS
 *      re-declaring a token there.
 *   2. Add the matching role to `packages/theme/src/defaultDarkTheme.ts`
 *      (re-exported through ui-kit and ui) if a call site needs it from
 *      JS rather than CSS.
 *   4. Reference via `var(--color-...)` in styled-components, or
 *      `${({ theme }) => theme.colors...}` if the call site needs JS.
 *
 * Run `node scripts/palette-audit.mjs` to triage existing raw hex.
 */

// Files that legitimately contain raw hex: sources of truth, fixtures,
// and data files (e.g. body-colour metadata). Anything else is an offender.
const ALLOWED_PATHS = [
  "packages/app/src/styles/global.css",
  "packages/ui/src/themes/defaultDark.ts",
  "packages/core/src/registry.test.ts",
  // stock-bodies.ts: per-body colour metadata for celestial bodies
  // (KSP planets/moons). These are data, not theme tokens, each body
  // needs a distinct colour for map / orbit / system views.
  "packages/core/src/stock-bodies.ts",
  // rss-bodies.ts: same per-body colour metadata for the RealSolarSystem
  // bodies (Earth/Moon/Mars/…). Data, not theme tokens.
  "packages/core/src/rss-bodies.ts",
  // ShipMap/render.ts: embeds the design tokens as a literal <style>
  // block inside the standalone SVG so the snapshot harness and export
  // path render the same colours as the live widget without a runtime
  // theme provider. Mirrors defaultDark.ts in spirit: token source of
  // truth duplicated for a self-contained output target.
  "packages/components/src/ShipMap/render.ts",
  // Navball/render.ts: same pattern as ShipMap/render.ts, design
  // tokens duplicated into a standalone SVG for snapshot/export.
  "packages/components/src/Navball/render.ts",
  // Minimap.tsx: canvas 2D `fillStyle` only accepts colour strings,
  // not CSS var() references. The minimap is a small enough surface
  // that resolving via getComputedStyle would add a runtime cost for
  // no real benefit; the few literals here are duplicates of existing
  // tokens and stay green-by-discipline rather than gate.
  "packages/components/src/Scanning/Minimap.tsx",
  // MapView/index.tsx: same canvas 2D `fillStyle` constraint as Minimap. The
  // map/overlay canvases resolve theme tokens at draw time via canvasColor();
  // the raw hex is only the getComputedStyle fallback, not a styled colour.
  "packages/components/src/MapView/index.tsx",
  // ScanSat Minimap.tsx: the mod-side copy of the same widget, and the same
  // canvas 2D `fillStyle` constraint as the packages/ copy above. Two of its
  // three literals are fillStyle assignments; the third is the background
  // colour quoted inside the comment that explains them.
  "mod/GonogoScansatUplink/client/src/Scanning/Minimap.tsx",
];

// Source roots to scan, shared with the token ratchet so the two can
// never disagree about what is covered; see `styleguideScanRoots.ts` for
// why each `packages/*\/src` is in or out (the relay is a server, the
// theme package is the token source of truth) and why the mod client
// roots are resolved by listing rather than enumerated.
const SCAN_ROOTS = styleguideScanRoots(
  findRepoRoot(dirname(fileURLToPath(import.meta.url))),
);

// Current baseline. When you drop the count, lower this number in the
// same commit. The test surfaces a hint when you can. Goal: hold at 0.
//
// 1: `mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx`'s
// `#c9c9c9` on the feed-unavailable scrim, the only offender the widened
// roots turned up. It sat outside the scan for as long as the mod tree
// did. Route it through a `--color-text-*` token (it is a near-miss of
// `--color-text-primary`, so the swap is a visible change and wants its
// own commit plus a baseline regen) and drop this to 0.
const HEX_OCCURRENCE_BASELINE = 1;

const HEX_RE =
  /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

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
    else if (/\.(tsx?|css)$/.test(name)) yield path;
  }
}

function collectOffenders(): { file: string; line: number; hex: string }[] {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const offenders: { file: string; line: number; hex: string }[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    const abs = join(root, scanRoot);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = relative(root, file);
      if (ALLOWED_PATHS.includes(rel)) continue;
      if (rel.includes(".test.")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, i) => {
        for (const m of text.matchAll(HEX_RE)) {
          offenders.push({ file: rel, line: i + 1, hex: m[0] });
        }
      });
    }
  }
  return offenders;
}

describe("design-system: raw hex literals", () => {
  it("does not exceed the rachet baseline", () => {
    const offenders = collectOffenders();
    if (offenders.length > HEX_OCCURRENCE_BASELINE) {
      // Surface up to 10 of the new offenders so the failure message is
      // actionable instead of just a count.
      const newCount = offenders.length - HEX_OCCURRENCE_BASELINE;
      const sample = offenders
        .slice(-Math.min(10, newCount))
        .map((o) => `  ${o.file}:${o.line}  ${o.hex}`)
        .join("\n");
      throw new Error(
        `Raw hex literal count (${offenders.length}) exceeds baseline (${HEX_OCCURRENCE_BASELINE}) by ${newCount}.\n` +
          `Add new colours to packages/theme/src/tokens.css as --color-* tokens ` +
          `or reuse an existing token. ` +
          `Do NOT add them to packages/app/src/styles/global.css: tokenSingleSource.test.ts ` +
          `forbids re-declaring a token there. Recent offenders:\n${sample}`,
      );
    }
    if (offenders.length < HEX_OCCURRENCE_BASELINE) {
      // Cleanup is welcome, but tighten the baseline so the gate keeps
      // ratcheting. Print rather than fail so the cleanup commit lands
      // green; updating the constant is then a tiny follow-up edit.
      console.warn(
        `[styleguide] hex baseline can be lowered: ${HEX_OCCURRENCE_BASELINE} → ${offenders.length}. ` +
          `Update HEX_OCCURRENCE_BASELINE in packages/core/src/styleguide.test.ts.`,
      );
    }
    expect(offenders.length).toBeLessThanOrEqual(HEX_OCCURRENCE_BASELINE);
  });
});

describe("design-system: ratchet scan coverage", () => {
  // The failure mode this catches is the one that actually happened: the
  // hex ratchet's root list was written when the repo had six UI
  // packages, three more landed, and nobody noticed the gate had stopped
  // covering them. A new package is now a test failure, not a silence.
  it("scans or explicitly excuses every packages/*/src", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const onDisk = readdirSync(join(root, "packages"))
      .map((name) => `packages/${name}/src`)
      .filter((rel) => existsSync(join(root, rel)))
      .sort();
    const accounted = new Set([
      ...SCANNED_PACKAGE_ROOTS,
      ...UNSCANNED_PACKAGE_ROOTS.map((entry) => entry.path),
    ]);
    const unaccounted = onDisk.filter((rel) => !accounted.has(rel));
    if (unaccounted.length > 0) {
      throw new Error(
        `These source roots are neither scanned nor excused:\n` +
          unaccounted.map((rel) => `  ${rel}`).join("\n") +
          `\nAdd each to SCANNED_PACKAGE_ROOTS in packages/core/src/styleguideScanRoots.ts, ` +
          `or to UNSCANNED_PACKAGE_ROOTS with a reason if it renders nothing.`,
      );
    }
    expect(unaccounted).toEqual([]);
  });

  it("does not excuse a root that no longer exists", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const stale = UNSCANNED_PACKAGE_ROOTS.filter(
      (entry) => !existsSync(join(root, entry.path)),
    ).map((entry) => entry.path);
    expect(stale).toEqual([]);
  });

  it("gives every excused root a substantive reason", () => {
    for (const entry of UNSCANNED_PACKAGE_ROOTS) {
      expect(
        entry.reason.trim().length,
        `${entry.path} needs a reason explaining why it is outside the ratchets`,
      ).toBeGreaterThan(30);
    }
  });
});
