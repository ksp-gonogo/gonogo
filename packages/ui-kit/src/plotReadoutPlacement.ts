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
  /** Width the column's widest line needs to be read whole: a legend chip, a caption, a card row, in CSS pixels. */
  contentWidth: number;
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
  | {
      /** The card, legend and captions sit over the plot. */
      placement: "overlay";
    }
  | {
      /** The card, legend and captions sit in a column beside the plot. */
      placement: "beside";
      /** The column's width, in CSS px. */
      columnWidth: number;
    };

/** Narrowest chart that still leaves the plot a usable width beside a column. */
const BESIDE_MIN_WIDTH = 480;

/** Shortest chart whose column can hold a card of a few rows. */
const BESIDE_MIN_HEIGHT = 110;

const COLUMN_MIN_PX = 112;
const COLUMN_MAX_PX = 260;
/** The column never takes more than this share of the chart. */
const COLUMN_MAX_SHARE = 0.4;
/** What the chart must keep for the plot, its axes and its margins once the column is taken. */
const PLOT_KEEPS_PX = 300;

/**
 * Where the kit puts a chart's card, legend and captions, decided from
 * measured space. A chart with room gives them a column beside the plot, as
 * wide as its widest line needs so nothing is cut; one that cannot spare that
 * width, or is smaller, keeps them over the plot.
 *
 * @category LineGraph
 */
export function placePlotReadouts({
  width,
  height,
  contentWidth,
}: PlotReadoutSpace): PlotReadoutPlacement {
  const columnWidth = Math.max(COLUMN_MIN_PX, Math.ceil(contentWidth));
  if (
    width < BESIDE_MIN_WIDTH ||
    height < BESIDE_MIN_HEIGHT ||
    columnWidth > Math.min(COLUMN_MAX_PX, width * COLUMN_MAX_SHARE) ||
    width - columnWidth < PLOT_KEEPS_PX
  ) {
    return { placement: "overlay" };
  }
  return { placement: "beside", columnWidth };
}
