import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `packages/theme/src/GonogoTokens.tsx` is a hand-maintained styled-components
 * mirror of `packages/theme/src/tokens.css`. Both are public mounting paths for
 * the tokens: a host either imports `@ksp-gonogo/ui-kit/tokens.css` or renders
 * `<GonogoTokens />`, and this package (which publishes both) promises they are
 * interchangeable.
 *
 * They were not. The mirror had fallen 39 custom properties behind: the whole
 * `--space-*`, `--radius-*`, `--z-*`, `--duration-*`, `--ease-*` and
 * `--line-height-*` families, plus `--font-size-2xs` and
 * `--color-status-nogo-on-bg`. On the `GonogoTokens` path every one of those
 * `var()` references resolved to nothing, so a padding computed to its initial
 * `0` and the layout collapsed. Nothing in the repo mounts that path, which is
 * exactly why it rotted silently.
 *
 * Same ratchet shape as `packages/app/src/styles/tokenSingleSource.test.ts`:
 * an exact boundary, not a shrink-only baseline. Add a token to `tokens.css`
 * and this fails until the mirror gets it too. `tokens.css` is the source of
 * truth; edit it first.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_SRC = resolve(HERE, "../../theme/src");

/** Both files are heavily commented, and the prose names both tokens and
 *  `@media` queries it is not declaring (`tokens.css` discusses
 *  `prefers-reduced-motion`, for one). Strip comments before anything else so
 *  neither the parser nor the block split can be fooled by them. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** `--name: value;` declarations, in source order. */
function declarations(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  return out;
}

/** Split a token sheet into its base `:root` block and its coarse-pointer
 *  override block, so a value that only differs under `@media (pointer:
 *  coarse)` is compared against the right counterpart. */
function blocks(text: string): { base: string; coarse: string } {
  const code = stripComments(text);
  const at = code.indexOf("@media");
  if (at === -1) throw new Error("no @media (pointer: coarse) block found");
  return { base: code.slice(0, at), coarse: code.slice(at) };
}

describe("GonogoTokens mirrors tokens.css", () => {
  const css = readFileSync(resolve(THEME_SRC, "tokens.css"), "utf8");
  const tsx = readFileSync(resolve(THEME_SRC, "GonogoTokens.tsx"), "utf8");

  const cssBlocks = blocks(css);
  const tsxBlocks = blocks(tsx);

  it("finds tokens in both files (sanity check for the parser itself)", () => {
    expect(declarations(cssBlocks.base).size).toBeGreaterThan(80);
    expect(declarations(tsxBlocks.base).size).toBeGreaterThan(80);
  });

  for (const which of ["base", "coarse"] as const) {
    it(`declares exactly the same ${which} tokens, with the same values`, () => {
      const want = declarations(cssBlocks[which]);
      const got = declarations(tsxBlocks[which]);

      const missing = [...want.keys()].filter((k) => !got.has(k));
      const extra = [...got.keys()].filter((k) => !want.has(k));
      const differing = [...want.entries()]
        .filter(([k, v]) => got.has(k) && got.get(k) !== v)
        .map(([k, v]) => `${k}: ${v} (css) vs ${got.get(k)} (GonogoTokens)`);

      expect({ missing, extra, differing }).toEqual({
        missing: [],
        extra: [],
        differing: [],
      });
    });
  }
});
