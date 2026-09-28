/** An RGBA raster, as `pngjs` decodes one. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface CheckerCells {
  /** A whole cell's rendered width, px. */
  cellWidth: number;
  /** A whole cell's rendered height, px. */
  cellHeight: number;
  /** How many cells the raster shows across, partial edge cells included as fractions. */
  columns: number;
  /** How many cells the raster shows down. */
  rows: number;
}

/**
 * Measures a rendered checkerboard of square cells: the width and height of
 * one whole cell, and how many cells are visible on each axis.
 *
 * The three ways a framed picture goes wrong read differently here. Distortion
 * makes `cellWidth` differ from `cellHeight`. Cropping keeps the cells square
 * and shows fewer of them. A reshaped field of view keeps them square and shows
 * a different count on one axis.
 *
 * Cells are read along lines a quarter, a half and three quarters of the way
 * across, and only cells bounded by a colour change on both sides count, since
 * an edge cell is cut by the frame. Refuses a raster with fewer than two whole
 * cells on either axis, which cannot tell a cell from a crop.
 */
export function measureCheckerCells(raster: Raster): CheckerCells {
  const cellWidth = wholeRun(raster, "x");
  const cellHeight = wholeRun(raster, "y");
  return {
    cellWidth,
    cellHeight,
    columns: raster.width / cellWidth,
    rows: raster.height / cellHeight,
  };
}

function isLight(raster: Raster, x: number, y: number): boolean {
  const i = (y * raster.width + x) * 4;
  const { data } = raster;
  return data[i] + data[i + 1] + data[i + 2] > 3 * 128;
}

/**
 * A whole cell's length along one axis, to a fraction of a pixel: the span
 * from the first colour change to the last divided by the cells between them,
 * averaged over the three lines. Whole-pixel run lengths alone quantise a
 * small cell too coarsely to count cells by.
 */
function wholeRun(raster: Raster, axis: "x" | "y"): number {
  const along = axis === "x" ? raster.width : raster.height;
  const across = axis === "x" ? raster.height : raster.width;
  const spans: number[] = [];
  for (const fraction of [0.25, 0.5, 0.75]) {
    const line = Math.floor(across * fraction);
    const edges: number[] = [];
    let previous = sample(raster, axis, 0, line);
    for (let i = 1; i < along; i++) {
      const current = sample(raster, axis, i, line);
      if (current === previous) continue;
      edges.push(i);
      previous = current;
    }
    if (edges.length < 3) continue;
    spans.push((edges[edges.length - 1] - edges[0]) / (edges.length - 1));
  }
  if (spans.length === 0) {
    throw new Error(
      `measureCheckerCells: fewer than two whole cells along ${axis} in a ` +
        `${raster.width}x${raster.height} raster, so a cell cannot be told from a crop`,
    );
  }
  return spans.reduce((sum, span) => sum + span, 0) / spans.length;
}

function sample(
  raster: Raster,
  axis: "x" | "y",
  at: number,
  line: number,
): boolean {
  return axis === "x" ? isLight(raster, at, line) : isLight(raster, line, at);
}
