/**
 * The gap between tiles, the same on both axes so it reads the same at rest.
 * Each tile's grab bar (18px) is drawn in the gap above it, so the gap must be
 * at least that tall and leave the bar clear of the tile above.
 */
export const GRID_GAP = 20;

/**
 * Row height plus gap, in px: the pitch the grid had before the gap grew. The
 * row height is derived from it, so rows still sit 33px apart and a tile `h`
 * rows tall is `33h - GRID_GAP` px, the gap now taken out of the tile and not
 * added to the page.
 */
export const ROW_PITCH = 33;

/**
 * The grid width, in px, past which rows grow. Up to it a row keeps the 33px
 * pitch whatever the width; beyond it the row pitch grows in step with the
 * column pitch, so a tile keeps the shape it had at this width rather than
 * stretching sideways on a very wide screen.
 */
const WIDE_GRID_FROM = 1920;

/** The row height for a grid `width` px wide. */
export function rowHeightFor(width: number): number {
  if (width <= WIDE_GRID_FROM) return ROW_PITCH - GRID_GAP;
  // A column's pitch is (width + gap) / COLS, so the pitch ratio is the ratio of (width + gap).
  const scale = (width + GRID_GAP) / (WIDE_GRID_FROM + GRID_GAP);
  return Math.round(ROW_PITCH * scale) - GRID_GAP;
}

/**
 * The whole grid units a box of `px` pixels spans along one axis, given the
 * pitch (a unit plus its gap) the grid has. The inverse of how the grid sizes a
 * tile: `n` units are `n * pitch - GRID_GAP` px.
 */
export function unitsForPx(px: number, pitch: number): number {
  return Math.max(1, Math.floor((px + GRID_GAP) / pitch));
}

/**
 * The grid units a widget is given when it is shown in a box of `widthPx` by
 * `heightPx` on a dashboard laid out across `gridWidthPx`, using the grid's own
 * column and row pitch so a widget that adapts to its tile adapts to the box.
 */
export function gridUnitsForBox(
  widthPx: number,
  heightPx: number,
  gridWidthPx: number,
  cols: number,
): { w: number; h: number } {
  const colPitch = (gridWidthPx + GRID_GAP) / cols;
  const rowPitch = rowHeightFor(gridWidthPx) + GRID_GAP;
  return {
    w: Math.min(cols, unitsForPx(widthPx, colPitch)),
    h: unitsForPx(heightPx, rowPitch),
  };
}
