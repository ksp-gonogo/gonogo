/**
 * A checkered-flag test for framed pictures: paint a pattern of square cells
 * into a box and ask what a cell looks like on screen, with no pixels involved.
 *
 * Three different faults make a framed picture look wrong, and they are easy to
 * mistake for each other by eye:
 *
 * - **distortion**: the picture is scaled by different amounts per axis, so a
 *   square cell renders as a rectangle
 * - **cropping**: cells stay square, but some of them are painted outside the
 *   box and lost off its edge
 * - **field of view**: cells stay square and nothing is cut off, but the source
 *   was rendered showing a different grid than the one intended, so more or
 *   fewer cells are visible
 *
 * jsdom lays nothing out, so this is geometry rather than measurement: the
 * caller supplies the box it gave the picture, and the fit comes from the
 * element (see {@link fitOf}) or is stated.
 */

/**
 * A pattern of square cells, `cols` wide and `rows` high. Either may be fractional.
 *
 * @category Testing
 */
export interface CheckerGrid {
  cols: number;
  rows: number;
}

/**
 * The `object-fit` values that scale a picture to its box.
 *
 * @category Testing
 */
export type CheckerFit = "fill" | "contain" | "cover";

/**
 * How a {@link CheckerGrid} lands in a box under a given fit, in CSS px.
 *
 * @category Testing
 */
export interface CheckerPaint {
  /** The grid the source picture carries. */
  grid: CheckerGrid;
  fit: CheckerFit;
  box: { width: number; height: number };
  /** The painted picture's own size, which exceeds `box` on a cropped axis and falls short of it on a letterboxed one. */
  painted: { width: number; height: number };
  cellWidth: number;
  cellHeight: number;
  /** Cells visible inside the box per axis, never more than the grid holds. */
  visible: CheckerGrid;
}

/**
 * One of the three ways a framed picture goes wrong. `distortion` renders a
 * square cell as a rectangle; `cropping` keeps cells square and loses some
 * off the box's edge; `field-of-view` keeps cells square and whole but shows a
 * different grid from the one intended.
 *
 * @category Testing
 */
export type FramingFault = "distortion" | "cropping" | "field-of-view";

/**
 * Relative slack on every comparison, 1%. A box floored to whole pixels to fit a
 * feed's aspect sits a fraction of a percent off it, which is not a fault; a
 * real distortion is far larger.
 *
 * @category Testing
 */
export const CHECKER_TOLERANCE = 0.01;

/**
 * Paint `grid` into `box` under `fit`, centred as `object-position` defaults.
 * The source's pixel size never matters: every supported fit scales it to the
 * box, so only its shape does, and that is the grid's.
 *
 * @category Testing
 */
export function paintChecker(
  grid: CheckerGrid,
  box: { width: number; height: number },
  fit: CheckerFit,
): CheckerPaint {
  if (!(grid.cols > 0 && grid.rows > 0 && box.width > 0 && box.height > 0)) {
    throw new Error(
      `paintChecker needs a positive grid and box, got ${grid.cols}x${grid.rows} cells into ${box.width}x${box.height}px`,
    );
  }
  const scaleX = box.width / grid.cols;
  const scaleY = box.height / grid.rows;
  const [cellWidth, cellHeight] =
    fit === "fill"
      ? [scaleX, scaleY]
      : fit === "contain"
        ? [Math.min(scaleX, scaleY), Math.min(scaleX, scaleY)]
        : [Math.max(scaleX, scaleY), Math.max(scaleX, scaleY)];
  return {
    grid,
    fit,
    box,
    painted: { width: cellWidth * grid.cols, height: cellHeight * grid.rows },
    cellWidth,
    cellHeight,
    visible: {
      cols: Math.min(grid.cols, box.width / cellWidth),
      rows: Math.min(grid.rows, box.height / cellHeight),
    },
  };
}

/**
 * Every {@link FramingFault} `paint` shows.
 * `intended` is the grid the picture was meant to carry (a camera's own
 * aspect, say); without it a field-of-view change cannot be told from a
 * faithful picture, so it is never reported.
 *
 * @category Testing
 */
export function framingFaults(
  paint: CheckerPaint,
  intended?: CheckerGrid,
): FramingFault[] {
  const faults: FramingFault[] = [];
  if (!near(paint.cellWidth, paint.cellHeight)) faults.push("distortion");
  if (
    below(paint.visible.cols, paint.grid.cols) ||
    below(paint.visible.rows, paint.grid.rows)
  ) {
    faults.push("cropping");
  }
  if (
    intended &&
    !(
      near(paint.grid.cols, intended.cols) &&
      near(paint.grid.rows, intended.rows)
    )
  ) {
    faults.push("field-of-view");
  }
  return faults;
}

/**
 * The fit an element paints its picture with. An `<svg>` takes it from its
 * `preserveAspectRatio` (`none` fills, `slice` covers, anything else
 * contains); every other element from its `object-fit`, which is `fill` unless
 * set, and `contain` on a `<video>`, whose user-agent style says so. Throws for
 * an `<svg>` with no `viewBox`, which does not scale its content at all, and
 * for `none` or `scale-down`, which depend on a pixel size the checker does not
 * have.
 *
 * @category Testing
 */
export function fitOf(element: Element): CheckerFit {
  if (element.tagName.toLowerCase() === "svg") {
    if (!element.hasAttribute("viewBox")) {
      throw new Error(
        "fitOf: an <svg> without a viewBox draws in CSS px and scales nothing, so it has no fit",
      );
    }
    const ratio = element.getAttribute("preserveAspectRatio") ?? "";
    if (ratio.trim() === "none") return "fill";
    return /\bslice\b/.test(ratio) ? "cover" : "contain";
  }
  const declared =
    (element as HTMLElement).style?.getPropertyValue("object-fit") ||
    getComputedStyle(element).getPropertyValue("object-fit") ||
    "fill";
  if (declared === "fill" || declared === "contain" || declared === "cover") {
    return declared;
  }
  throw new Error(
    `fitOf: object-fit "${declared}" sizes the picture by its pixels, which the checker does not model`,
  );
}

function near(a: number, b: number): boolean {
  return (
    Math.abs(a - b) <= CHECKER_TOLERANCE * Math.max(Math.abs(a), Math.abs(b))
  );
}

function below(visible: number, total: number): boolean {
  return visible < total * (1 - CHECKER_TOLERANCE);
}
