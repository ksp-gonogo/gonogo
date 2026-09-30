/**
 * The width of one dashboard grid column in CSS pixels, an approximation at
 * the `lg` breakpoint (36 columns): on the dashboard a column's real width is a
 * fraction of the container. Use it to lay a widget out outside the dashboard,
 * such as in a test harness or a docs page.
 *
 * @category Layout
 */
export const COL_WIDTH = 32;

/**
 * The height of one dashboard grid row in CSS pixels.
 *
 * @category Layout
 */
export const ROW_HEIGHT = 25;

/**
 * The gap between adjacent dashboard grid cells in CSS pixels.
 *
 * @category Layout
 */
export const GRID_MARGIN = 8;

/**
 * The pixel box of a `w` by `h` grid-unit tile, as `{ pxW, pxH }`. The margin
 * falls between cells, so `n` cells carry `n - 1` gaps and a single cell
 * carries none.
 *
 * @category Layout
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
