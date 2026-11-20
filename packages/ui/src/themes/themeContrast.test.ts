// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getThemes } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import {
  CONTRAST_FLOOR,
  contrastRatio,
  contrastTable,
  parseColorTokens,
  themeVariables,
} from "../../../theme/src";
import "../index";

/**
 * Every bundled theme clears the contrast table on the values it resolves to:
 * its own variables laid over the sheet, with a tone's derived steps mixed
 * out the way the browser mixes them.
 */
const TOKENS_CSS = fileURLToPath(
  new URL("../../../theme/src/tokens.css", import.meta.url),
);
const sheet = new Map<string, string>();
for (const m of readFileSync(TOKENS_CSS, "utf8").matchAll(
  /(--[\w-]+)\s*:\s*([^;]+);/g,
)) {
  sheet.set(m[1], m[2].trim());
}

function rgb(hex: string): number[] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

function resolve(value: string, vars: Map<string, string>): string {
  const v = value.trim().match(/^var\((--[\w-]+)\)$/);
  if (v) return resolve(vars.get(v[1]) ?? "#ff00ff", vars);
  const m = value.trim().match(/^color-mix\(in srgb, (.+?) (\d+)%, (.+)\)$/);
  if (!m) return value.trim();
  const a = rgb(resolve(m[1], vars));
  const b = rgb(resolve(m[3], vars));
  const keep = Number(m[2]) / 100;
  return `#${a
    .map((x, i) =>
      Math.round(x * keep + b[i] * (1 - keep))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function failingPairings(variables: Record<string, string>): string[] {
  const all = new Map(sheet);
  for (const [k, v] of Object.entries(variables)) all.set(k, v);
  const css = `:root{${[...all.keys()].map((k) => `${k}:${resolve(all.get(k) as string, all)};`).join("")}}`;
  const tokens = parseColorTokens(css);
  const failures: string[] = [];
  for (const p of contrastTable([...tokens.keys()])) {
    const fg = tokens.get(p.token);
    for (const on of p.on) {
      const bg = tokens.get(on);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio < CONTRAST_FLOOR[p.kind]) {
        failures.push(`${p.token} on ${on}: ${ratio.toFixed(2)}`);
      }
    }
  }
  return failures;
}

describe("bundled themes", () => {
  const themes = getThemes();

  it("bundles the default and four more", () => {
    expect(themes.map((t) => t.id)).toEqual([
      "default-dark",
      "apollo",
      "daylight",
      "dense",
      "high-contrast",
    ]);
  });

  const report: Record<string, string[]> = {};
  for (const t of themes) {
    it(`${t.id} passes every contrast pairing`, () => {
      const failures = failingPairings(themeVariables(t.theme));
      report[t.id] = failures;
      expect(failures).toEqual([]);
    });
  }

  it("writes the report when asked", () => {
    const out = process.env.GONOGO_THEME_REPORT;
    if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  });
});
