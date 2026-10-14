/**
 * The cells a relief is drawn on, which open water over the same bounds is drawn on too, so a coast meets the land cell for cell.
 */

/** Cells a side: a relief's grid of heights is resampled to this many before it is shaded. */
export const RELIEF_RESOLUTION = 56;

/** Bilinear sample of a row-major grid at continuous (col, row). */
export function sampleGrid(
  values: readonly number[],
  size: number,
  col: number,
  row: number,
): number {
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(col)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(row)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, col - x0));
  const fy = Math.max(0, Math.min(1, row - y0));
  const top =
    values[y0 * size + x0] +
    (values[y0 * size + x1] - values[y0 * size + x0]) * fx;
  const bottom =
    values[y1 * size + x0] +
    (values[y1 * size + x1] - values[y1 * size + x0]) * fx;
  return top + (bottom - top) * fy;
}
