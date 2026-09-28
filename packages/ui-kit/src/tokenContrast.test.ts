// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TONES } from "@ksp-gonogo/sitrep-sdk";
import {
  CONTRAST_FLOOR,
  contrastRatio,
  contrastTable,
  DECORATIVE,
  EXEMPT,
  GROUNDS,
  NAMED_PAIR_EXCEPTIONS,
  namedPairings,
  parseColorTokens,
  TONE_NAMES,
  TONE_ROLES,
} from "@ksp-gonogo/theme";
import { describe, expect, it } from "vitest";

/**
 * The theme half of the contrast gate: every pairing the table declares
 * clears its WCAG floor on the values in the theme's own sheet, and every
 * colour token the sheet declares is placed somewhere in the table.
 *
 * The sheet is read from the theme's source rather than the built copy, so a
 * changed value is measured without a rebuild.
 */
const TOKENS_CSS = fileURLToPath(
  new URL("../../theme/src/tokens.css", import.meta.url),
);
const tokens = parseColorTokens(readFileSync(TOKENS_CSS, "utf8"));
const names = [...tokens.keys()];
const table = contrastTable(names);

const fmt = (r: number) => `${r.toFixed(2)}:1`;

function failingPairings(sheet: ReadonlyMap<string, string>): string[] {
  const failures: string[] = [];
  for (const p of contrastTable([...sheet.keys()])) {
    const fg = sheet.get(p.token);
    for (const ground of p.on) {
      const bg = sheet.get(ground);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio < CONTRAST_FLOOR[p.kind]) {
        failures.push(
          `${p.token} (${fg}) on ${ground} (${bg}) is ${fmt(ratio)}, ${p.kind} needs ${CONTRAST_FLOOR[p.kind]}:1`,
        );
      }
    }
  }
  return failures;
}

describe("theme contrast table", () => {
  it("reads the colour tokens from the theme's sheet", () => {
    expect(tokens.get("surface-panel")).toMatch(/^#/);
    expect(names.length).toBeGreaterThan(40);
  });

  it("clears the WCAG floor for every declared pairing", () => {
    expect(failingPairings(tokens)).toEqual([]);
  });

  it("fails a tone role that misses its floor", () => {
    const planted = new Map(tokens);
    planted.set("warn-text", "#3a2a0a");
    planted.set("go-mark", "#1a2a1a");
    const failures = failingPairings(planted);
    expect(
      failures.some((f) =>
        f.startsWith("warn-text (#3a2a0a) on surface-panel"),
      ),
    ).toBe(true);
    expect(
      failures.some((f) => f.startsWith("go-mark (#1a2a1a) on surface-panel")),
    ).toBe(true);
  });

  it("names the same tones as the sdk's scale", () => {
    expect([...TONE_NAMES]).toEqual([...TONES]);
  });

  it("declares every role for every tone, each resolving to a colour", () => {
    const missing = TONE_NAMES.flatMap((tone) =>
      TONE_ROLES.map((role) => `${tone}-${role}`),
    ).filter((name) => !tokens.has(name));
    expect(missing).toEqual([]);
  });

  it("resolves a role token through its palette alias", () => {
    expect(tokens.get("warn-mark")).toBe("#ff8c00");
    expect(tokens.get("go-on-status")).toBe("#cfe");
    expect(tokens.get("neutral-text")).toBe(tokens.get("text-primary"));
  });

  it("names only tokens the sheet declares", () => {
    const declared = new Set(names);
    const named = new Set<string>([
      ...table.flatMap((p) => [p.token, ...p.on]),
      ...GROUNDS,
      ...DECORATIVE,
      ...Object.keys(EXEMPT),
      ...NAMED_PAIR_EXCEPTIONS.flatMap((e) => [e.token, e.on]),
    ]);
    expect([...named].filter((n) => !declared.has(n)).sort()).toEqual([]);
  });

  it("places every colour token the sheet declares", () => {
    const placed = new Set<string>([
      ...table.map((p) => p.token),
      ...GROUNDS,
      ...DECORATIVE,
      ...Object.keys(EXEMPT),
    ]);
    expect(names.filter((n) => !placed.has(n)).sort()).toEqual([]);
  });

  it("drops a named pairing only where it genuinely fails", () => {
    const passing: string[] = [];
    for (const e of NAMED_PAIR_EXCEPTIONS) {
      const promised = namedPairings(names).some(
        (p) => p.token === e.token && p.on.includes(e.on),
      );
      const fg = tokens.get(e.token);
      const bg = tokens.get(e.on);
      if (!promised) {
        passing.push(`${e.token} on ${e.on} is not a named pairing`);
        continue;
      }
      if (fg && bg && contrastRatio(fg, bg) >= CONTRAST_FLOOR.text) {
        passing.push(
          `${e.token} on ${e.on} is ${fmt(contrastRatio(fg, bg))}, so it is a pairing rather than an exception`,
        );
      }
    }
    expect(passing).toEqual([]);
  });

  it("computes the WCAG ratio", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#1a1a1a", "#ff8c00")).toBeCloseTo(7.46, 2);
    expect(contrastRatio("#777", "#777")).toBe(1);
  });
});
