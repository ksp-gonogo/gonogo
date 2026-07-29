import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-token guard: `packages/theme/src/tokens.css` is the single source
 * of truth for every `--color-*` custom property. This app's own
 * stylesheets (this directory) must consume that file via `@import
 * "@ksp-gonogo/theme/tokens.css";`, never re-declare a `--color-*` token
 * themselves.
 *
 * This is not a style nitpick: a re-declared copy already caused a real
 * bug. A fix added `--color-status-nogo-on-bg` to the theme package only;
 * `global.css` (which the app AND the render harness both actually load)
 * kept its own stale copy of the `:root` block without the new token, so
 * the app silently fell back to inherited text colour on the NOGO badge,
 * making the contrast bug the fix was supposed to correct worse (2.04:1
 * vs the original 2.61:1). It was caught by an agent eyeballing a
 * rendered PNG, not by any test, which is what this ratchet is for.
 *
 * Ratchet shape mirrors `packages/core/src/styleguide-emdash.test.ts`:
 * the allowed count is a hard boundary (zero re-declarations, one
 * `@import`), not a shrink-only baseline, because there is no legitimate
 * reason for the count to ever be anything else.
 *
 * If a consumer genuinely needs an app-local override, that's still
 * possible: scope it to a selector OTHER than `:root` (so it layers on
 * top of, rather than shadows, the shared token) and add the token name
 * to ALLOWED_LOCAL_OVERRIDES below with a comment explaining why. Do not
 * widen this test to allow a bare `:root` re-declaration.
 */

const STYLES_DIR = dirname(fileURLToPath(import.meta.url));
const EXPECTED_IMPORT = '@import "@ksp-gonogo/theme/tokens.css";';

// Empty on purpose: no app-local override exists today. See the header
// comment above for how to add one if a real need shows up.
const ALLOWED_LOCAL_OVERRIDES: readonly string[] = [];

function cssFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".css"));
}

/** Custom-property DECLARATIONS only (`--color-foo: ...`), not `var(--color-foo)`
 *  USAGES, which are the whole point of importing the tokens in the first place. */
function declaredColorTokens(css: string): string[] {
  const matches = css.matchAll(/(--color-[a-zA-Z0-9-]+)\s*:/g);
  return [...matches].map((m) => m[1]);
}

describe("design tokens: app stylesheets consume, never re-declare, --color-* tokens", () => {
  const files = cssFiles(STYLES_DIR);

  it("finds the css files this guard is meant to scan (sanity check for the scan itself)", () => {
    expect(files).toContain("global.css");
  });

  it("imports the shared tokens file from @ksp-gonogo/theme", () => {
    const globalCss = readFileSync(join(STYLES_DIR, "global.css"), "utf8");
    expect(globalCss).toContain(EXPECTED_IMPORT);
  });

  for (const file of cssFiles(STYLES_DIR)) {
    it(`${file}: declares no --color-* token of its own`, () => {
      const css = readFileSync(join(STYLES_DIR, file), "utf8");
      const declared = declaredColorTokens(css).filter(
        (token) => !ALLOWED_LOCAL_OVERRIDES.includes(token),
      );
      if (declared.length > 0) {
        throw new Error(
          `${file} declares --color-* token(s) that duplicate ` +
            `packages/theme/src/tokens.css: ${declared.join(", ")}. ` +
            "Delete the local declaration and rely on the @import instead " +
            "(packages/theme is the single source of truth). If this is a " +
            "deliberate, reviewed app-local override, add the token name to " +
            "ALLOWED_LOCAL_OVERRIDES in this test with a comment explaining " +
            "why, and scope the override to a selector other than :root.",
        );
      }
      expect(declared).toEqual([]);
    });
  }
});
