/**
 * Categorical data palette: 24 vivid, distinct colours intended for
 * series in charts, telemetry rows, body markers, peer chips, and any
 * place where the role is "make this category visually distinct from
 * its neighbours".
 *
 * Distinct from the `--color-tag-*` family in `global.css`, which is
 * for *labeled state* (a purple prediction chip, a blue station badge).
 * Tag colours communicate meaning; data colours only communicate
 * "different category from that one".
 *
 * Consumed through `dataColor(i)`, index-based and JSX-side. Colour
 * identity follows the DATA, so a data-keyed index survives a reordering
 * where a DOM-order rule would reassign every colour.
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
