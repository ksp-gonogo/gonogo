import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: prevent new raw hex colour literals leaking into
 * the codebase. Ratchet-style — every refactor that drops the count
 * lowers the baseline, every commit that introduces new raw hex fails
 * the build with a clear pointer at the offender.
 *
 * The expected route to landing colours:
 *   1. Add the value to `packages/app/src/styles/global.css` as a
 *      `--color-*` token (or pick an existing one).
 *   2. Add the matching role to `packages/ui/src/themes/defaultDark.ts`.
 *   3. Reference via `var(--color-...)` in styled-components, or
 *      `${({ theme }) => theme.colors...}` if the call site needs JS.
 *
 * Run `node scripts/palette-audit.mjs` to triage existing raw hex.
 */

// Files that legitimately contain raw hex — sources of truth, fixtures,
// and data files (e.g. body-colour metadata). Anything else is an offender.
const ALLOWED_PATHS = [
  "packages/app/src/styles/global.css",
  "packages/ui/src/themes/defaultDark.ts",
  "packages/core/src/registry.test.ts",
  // stock-bodies.ts: per-body colour metadata for celestial bodies
  // (KSP planets/moons). These are data, not theme tokens — each body
  // needs a distinct colour for map / orbit / system views.
  "packages/core/src/stock-bodies.ts",
];

// Source roots to scan. Excludes telnet-proxy / relay because they're
// servers, not UI.
const SCAN_ROOTS = [
  "packages/app/src",
  "packages/components/src",
  "packages/core/src",
  "packages/data/src",
  "packages/serial/src",
  "packages/ui/src",
];

// Current baseline. When you drop the count, lower this number in the
// same commit. The test surfaces a hint when you can. Goal: hold at 0.
const HEX_OCCURRENCE_BASELINE = 0;

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
          `Add new colours to packages/app/src/styles/global.css as --color-* tokens, ` +
          `or reuse an existing token. Recent offenders:\n${sample}`,
      );
    }
    if (offenders.length < HEX_OCCURRENCE_BASELINE) {
      // Cleanup is welcome — but tighten the baseline so the gate keeps
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
