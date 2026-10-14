/**
 * The width of one dashboard grid column in CSS pixels, an approximation for
 * the dashboard's widest layout (36 columns across): on the dashboard a
 * column's real width is a fraction of the container. Use it to lay a widget
 * out outside the dashboard, such as in a test harness or a docs page. Used by
 * the docs and probe renderers that draw a widget at its dashboard size.
 *
 * @category Layout
 */
export const COL_WIDTH = 21;

/**
 * The height of one dashboard grid row in CSS pixels. Useful for sizing a tile
 * the way the dashboard the operator sees does. Used by the dashboard grid.
 *
 * @category Layout
 */
export const ROW_HEIGHT = 13;

/**
 * The gap between adjacent dashboard grid cells in CSS pixels. Useful for
 * sizing a tile the way the dashboard the operator sees does. Used by the
 * dashboard grid.
 *
 * @category Layout
 */
export const GRID_MARGIN = 20;

/**
 * The pixel box of a `w` by `h` grid-unit tile, as `{ pxW, pxH }`. The margin
 * falls between cells, so `n` cells carry `n - 1` gaps and a single cell
 * carries none. Useful for drawing a widget at the size of its dashboard tile.
 * Used by {@link Panel} and by the probe that renders an Uplink's widget.
 *
 * @category Layout
 * @categoryDescription Layout
 * Arranging a widget's content: stacks, rows, clusters, grids, boxes, cards and
 * sections, the spacing scale they share, and the dashboard grid's cell sizes
 * for turning a tile's columns and rows into pixels.
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
