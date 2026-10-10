/**
 * What {@link placePlotReadouts} reads: the chart's measured size.
 *
 * @category LineGraph
 */
export interface PlotReadoutSpace {
  /** Width of the whole chart, in CSS pixels. */
  width: number;
  /** Height of the whole chart, in CSS pixels. */
  height: number;
}

/**
 * Where a chart's reading furniture stands: the crosshair card, the legend and
 * the limit or target captions.
 *
 * `beside` gives them a column to the right of the plot, so none covers a
 * trace or a dot. `overlay` keeps them inside the plot, drawn only where they
 * cover no data.
 *
 * @category LineGraph
 */
export type PlotReadoutPlacement =
  | { placement: "overlay" }
  | { placement: "beside"; columnWidth: number };

/** Narrowest chart that still leaves the plot a usable width beside a column. */
const BESIDE_MIN_WIDTH = 480;

/** Shortest chart whose column can hold a card of a few rows. */
const BESIDE_MIN_HEIGHT = 110;

const COLUMN_SHARE = 0.3;
const COLUMN_MIN_PX = 104;
const COLUMN_MAX_PX = 168;

/**
 * Where the kit puts a chart's card, legend and captions, decided from
 * measured space. A chart with room gives them a column beside the plot; a
 * smaller one keeps them over the plot.
 *
 * @category LineGraph
 */
export function placePlotReadouts({
  width,
  height,
}: PlotReadoutSpace): PlotReadoutPlacement {
  if (width < BESIDE_MIN_WIDTH || height < BESIDE_MIN_HEIGHT) {
    return { placement: "overlay" };
  }
  const columnWidth = Math.round(
    Math.min(COLUMN_MAX_PX, Math.max(COLUMN_MIN_PX, width * COLUMN_SHARE)),
  );
  return { placement: "beside", columnWidth };
}
