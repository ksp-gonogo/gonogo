/**
 * Size buckets for responsive widget rendering. Widgets read their `w`/`h`
 * grid units from `ComponentProps` and derive a bucket here so the boundaries
 * stay consistent across every widget.
 *
 * - `tiny`   — single-glance status / one key readout
 * - `small`  — essential numbers, minimal chrome
 * - `normal` — full widget UI
 *
 * Boundaries chosen so the existing `defaultSize`s land in `normal`, and the
 * minSize floors set per widget land in `tiny` or `small` once those modes
 * exist. Widgets without a tiny/small mode just render their normal UI at any
 * bucket — there's no requirement to handle every level.
 */
export type SizeBucket = "tiny" | "small" | "normal";

const TINY_W = 5;
const TINY_H = 4;
const SMALL_W = 8;
const SMALL_H = 7;

export function getSizeBucket(
  w: number | undefined,
  h: number | undefined,
): SizeBucket {
  // Missing dims (e.g. before the grid has measured) — assume normal so the
  // first paint isn't a flash of compact UI.
  if (w === undefined || h === undefined) return "normal";
  if (w < TINY_W || h < TINY_H) return "tiny";
  if (w < SMALL_W || h < SMALL_H) return "small";
  return "normal";
}
