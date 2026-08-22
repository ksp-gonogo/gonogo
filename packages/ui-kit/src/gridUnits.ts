/**
 * The dashboard grid's cell geometry, in CSS pixels.
 *
 * A widget's `defaultSize` / `minSize` are grid units, and anything that has to
 * lay one out outside the dashboard (a render harness sizing its mount box, a
 * docs page quoting a tile size) has to convert. Both numbers used to be
 * hand-mirrored in `packages/components/scripts/widgetRenderHarness.ts` with a
 * comment saying so, which is a copy of a layout constant living in a package no
 * Uplink can install: a third-party author sizing a render had nothing to read.
 *
 * `COL_WIDTH` approximates the `lg` breakpoint (36 columns) at a comfortable
 * viewport rather than being exact, because a column's real width is a fraction
 * of the container and there is no single number. `ROW_HEIGHT` and `GRID_MARGIN`
 * are the app's own values.
 */
export const COL_WIDTH = 32;
export const ROW_HEIGHT = 25;
export const GRID_MARGIN = 8;

/**
 * A tile's pixel box for a `w` x `h` span. The margin falls BETWEEN cells, so
 * `n` cells carry `n - 1` gaps and a single cell carries none.
 */
export function gridToPixels(
  w: number,
  h: number,
): {
  pxW: number;
  pxH: number;
} {
  return {
    pxW: w * COL_WIDTH + (w - 1) * GRID_MARGIN,
    pxH: h * ROW_HEIGHT + (h - 1) * GRID_MARGIN,
  };
}
