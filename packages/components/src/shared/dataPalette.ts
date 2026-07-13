import { css } from "styled-components";

/**
 * Categorical data palette — 24 vivid, distinct colours intended for
 * series in charts, telemetry rows, body markers, peer chips, and any
 * place where the role is "make this category visually distinct from
 * its neighbours".
 *
 * Distinct from the `--color-tag-*` family in `global.css`, which is
 * for *labeled state* (a purple prediction chip, a blue station badge).
 * Tag colours communicate meaning; data colours only communicate
 * "different category from that one".
 *
 * Two ways to consume:
 *
 *   1. `dataColor(i)` — index-based, JSX-side. Stable across reorderings
 *      if your index is data-keyed (preferred for charts, telemetry rows,
 *      anything where colour identity should follow the *data*).
 *
 *   2. `dataPaletteCycle()` — styled-components mixin that generates
 *      `:nth-child(24n+k)` rules. Apply to a list container to auto-
 *      colour direct children by DOM order. Order = colour, so reordering
 *      reassigns colours; only use when the list is purely positional
 *      (e.g. legend chips that always render in array order).
 */

export const DATA_PALETTE = [
  "var(--color-data-1)",
  "var(--color-data-2)",
  "var(--color-data-3)",
  "var(--color-data-4)",
  "var(--color-data-5)",
  "var(--color-data-6)",
  "var(--color-data-7)",
  "var(--color-data-8)",
  "var(--color-data-9)",
  "var(--color-data-10)",
  "var(--color-data-11)",
  "var(--color-data-12)",
  "var(--color-data-13)",
  "var(--color-data-14)",
  "var(--color-data-15)",
  "var(--color-data-16)",
  "var(--color-data-17)",
  "var(--color-data-18)",
  "var(--color-data-19)",
  "var(--color-data-20)",
  "var(--color-data-21)",
  "var(--color-data-22)",
  "var(--color-data-23)",
  "var(--color-data-24)",
] as const;

export function dataColor(index: number): string {
  return DATA_PALETTE[index % DATA_PALETTE.length];
}

/**
 * styled-components mixin: cycle the data palette across direct children
 * via `:nth-child(24n+k)` rules.
 *
 *   const Legend = styled.ul`
 *     ${dataPaletteCycle("color")}
 *   `;
 *
 * Each `<li>` (or whatever the direct child is) gets its `color` set to
 * `var(--color-data-1)`, `var(--color-data-2)`, ... cycling at 24.
 *
 * @param property the CSS property to cycle — `color`, `background`,
 *   `border-color`, etc. Pass a CSS variable name (e.g. `--data-color`)
 *   to set a custom property the children can consume themselves.
 * @param childSelector defaults to `> *`; override if the cycle should
 *   target a specific tag (e.g. `> .chip`).
 */
export function dataPaletteCycle(property = "color", childSelector = "> *") {
  // Generated as a single template chunk so styled-components emits one
  // styled-component class with all 24 rules — cheaper than 24 separate
  // mixin invocations.
  const rules = DATA_PALETTE.map(
    (colour, i) =>
      `${childSelector}:nth-child(${DATA_PALETTE.length}n+${i + 1}) { ${property}: ${colour}; }`,
  ).join("\n");
  return css`
    ${rules}
  `;
}
