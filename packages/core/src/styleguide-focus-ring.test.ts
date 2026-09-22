import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: a focus ring in ui-kit is drawn in the theme's FOCUS
 * colour.
 *
 * `packages/theme/src/theme.ts` declares `focus: string` as a slot and the
 * default theme fills it with `var(--color-focus)`. Twelve rings in the kit
 * were nonetheless drawn in `var(--color-accent-fg)`, which resolves to the
 * same value today, so nothing looked wrong and the role was unusable: a ring
 * spelled as an accent cannot be retuned without moving every accent in the
 * kit.
 *
 * Nothing was checking it. `tokenSingleSource.test.ts` guards a different
 * thing (that app stylesheets do not re-declare `--color-*`), and a declared
 * role being used where that role applies had no instrument at all. This is
 * that instrument, so the next hand-rolled ring cannot quietly reach for
 * whichever token the neighbouring line happens to use.
 *
 * The kit draws its rings through the shared `focusRing` / `focusRingInset`
 * fragments, so a compliant file carries no `outline` colour of its own at all.
 */

/** Where the ring colour is allowed to be spelled out. */
const RING_SOURCE = "packages/ui-kit/src/focusRing.ts";

/**
 * The one ring that is deliberately not the focus token.
 *
 * `InFlightList`'s queue square draws its border, its background tint and its
 * text from `currentColor`, which carries the command's phase. A ring in the
 * focus token would be the single part of that tile ignoring the phase.
 */
const CURRENT_COLOR_EXEMPT =
  "packages/ui-kit/src/CommandDelay/InFlightList.tsx";

/**
 * An `outline` declaration, anchored to the START of its line.
 *
 * `outline:` also occurs in prose: `CommandButton` has a comment reading "it
 * stays the quiet outline: a row", which an unanchored pattern reports as a
 * ring in the colour "a row".
 *
 * The value is captured whole and `none` is filtered in code rather than by a
 * lookahead. `outline:[ \t]*(?!none)` does NOT work: the whitespace backtracks
 * to empty, the lookahead then tests " none" instead of "none", and every
 * suppression is reported as a ring. That cost two runs of this file's own
 * planted test.
 */
const OUTLINE_RE = /^[ \t]*outline:[ \t]*([^;]+);/gm;

/** `outline: none` suppresses the UA ring; it does not draw one. */
function isRing(value: string): boolean {
  return value.trim() !== "none";
}

const ALLOWED_COLOUR = /var\(--color-focus\)/;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

function kitSources(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "packages/ui-kit/src"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\0")
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
}

function offenders(): { file: string; rule: string }[] {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const out: { file: string; rule: string }[] = [];
  for (const rel of kitSources(root)) {
    if (rel === RING_SOURCE || rel === CURRENT_COLOR_EXEMPT) continue;
    let text: string;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(OUTLINE_RE)) {
      if (!isRing(m[1])) continue;
      if (!ALLOWED_COLOUR.test(m[1]))
        out.push({ file: rel, rule: m[0].trim() });
    }
  }
  return out;
}

/**
 * Far under the ~200 sources the walk reaches, so ordinary churn never trips it
 * and only a broken enumeration does. A scan that stops finding files counts
 * zero offenders, and zero reads as a clean kit.
 */
const MINIMUM_FILES_SCANNED = 80;

describe("design-system: focus rings use the theme's focus role", () => {
  it("is actually looking at the kit", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    expect(kitSources(root).length).toBeGreaterThanOrEqual(
      MINIMUM_FILES_SCANNED,
    );
  });

  it("can see a violation (planted)", () => {
    // The matcher half. A pattern edited to stop matching reports a conformant
    // kit rather than a broken check, so every spelling here is one the scan
    // claims to catch.
    for (const planted of [
      "  outline: 2px solid var(--color-accent-fg);",
      "  outline:2px solid var(--color-accent-fg);",
      "  outline: 2px solid #00ff88;",
      "  outline: 2px solid currentColor;",
    ]) {
      const hits = [...planted.matchAll(OUTLINE_RE)];
      expect(hits).toHaveLength(1);
      expect(isRing(hits[0][1])).toBe(true);
      expect(ALLOWED_COLOUR.test(hits[0][1])).toBe(false);
    }
    // And passes the one spelling that is correct, plus the non-ring.
    const ok = [
      ..."  outline: 2px solid var(--color-focus);".matchAll(OUTLINE_RE),
    ];
    expect(ok).toHaveLength(1);
    expect(ALLOWED_COLOUR.test(ok[0][1])).toBe(true);
    // Matched by the pattern, and not a ring: a suppression.
    const supp = [..."  outline: none;".matchAll(OUTLINE_RE)];
    expect(supp).toHaveLength(1);
    expect(isRing(supp[0][1])).toBe(false);
    // Not matched at all: a sentence that happens to say it.
    expect([
      ...": At rest it stays the quiet outline: a row;".matchAll(OUTLINE_RE),
    ]).toHaveLength(0);
    expect([
      ...": At rest it stays the quiet outline: a row;".matchAll(OUTLINE_RE),
    ]).toHaveLength(0);
  });

  it("finds no ring drawn in another colour", () => {
    const found = offenders();
    if (found.length > 0) {
      throw new Error(
        `${found.length} focus ring(s) in ui-kit are not the theme's focus ` +
          `colour:\n${found.map((o) => `  ${o.file}: ${o.rule}`).join("\n")}\n` +
          `The theme declares a \`focus\` slot filled with var(--color-focus). ` +
          `Interpolate \`focusRing\` or \`focusRingInset\` from ` +
          `${RING_SOURCE} rather than spelling a colour here.`,
      );
    }
    expect(found).toEqual([]);
  }, 30_000);
});
