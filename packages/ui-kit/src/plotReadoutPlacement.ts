/**
 * The measured size of a chart, in CSS pixels. Useful for deciding where the
 * chart's readouts sit without covering the data the operator is reading. Taken
 * by {@link placePlotReadouts}.
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
  /** Height the legend chips need stacked in the column, in CSS pixels. Taken as 0 when omitted. */
  legendHeight?: number;
  /** Height the fixed card needs, in CSS pixels. Taken as 0 when omitted. */
  cardHeight?: number;
}

/**
 * Where a chart's readouts stand: the crosshair card, the legend and the limit
 * or target captions. Useful for keeping them off the traces the operator is
 * reading. Returned by {@link placePlotReadouts}.
 *
 * `beside` gives them a column to the right of the plot, so none covers a
 * trace or a dot. `below` is for a tall or narrow chart: the legend is a
 * horizontal strip under the plot, and the rest stay inside the plot as in
 * `overlay`. `overlay` keeps them all inside the plot, drawn only where they
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
      /** The legend sits in a strip under the plot; the card and captions sit over the plot. */
      placement: "below";
    }
  | {
      /** The card, legend and captions sit in a column beside the plot. */
      placement: "beside";
      /** The column's width, in CSS px. */
      columnWidth: number;
      /** Whether the legend sits in a strip under the plot because the column has no height for it beside the card. */
      legendBelow: boolean;
    };

/** Narrowest chart that still leaves the plot a usable width beside a column. */
const BESIDE_MIN_WIDTH = 480;

/** Shortest chart whose column can hold a card of a few rows. */
const BESIDE_MIN_HEIGHT = 110;

/** Shortest chart that can spare a strip under the plot for the legend. */
const BELOW_MIN_HEIGHT = 200;

/** What the plot's own margins, axis labels and axis title take of the chart's height, so the column's share is what is left. */
const PLOT_CHROME_PX = 56;

/** The height a legend strip under the plot takes. */
const LEGEND_STRIP_PX = 20;

const COLUMN_MIN_PX = 112;
const COLUMN_MAX_PX = 260;
/** The column never takes more than this share of the chart. */
const COLUMN_MAX_SHARE = 0.4;
/** What the chart must keep for the plot, its axes and its margins once the column is taken. */
const PLOT_KEEPS_PX = 300;

/**
 * The placement for a chart's card, legend and captions, decided from the
 * chart's measured space. Useful for keeping readouts off the data the operator
 * reads. Used by the line chart.
 *
 * A chart with room gives them a column beside the plot, as
 * wide as its widest line needs so nothing is cut, and as tall as the legend
 * and the card need stacked, or with the legend under the plot where the
 * column only has the height for the card. A chart taller than it is wide, or narrower than
 * a column allows, but tall enough for a strip, puts the legend under the plot;
 * one that is smaller keeps them over the plot.
 *
 * @category LineGraph
 */
export function placePlotReadouts({
  width,
  height,
  contentWidth,
  legendHeight = 0,
  cardHeight = 0,
}: PlotReadoutSpace): PlotReadoutPlacement {
  const columnWidth = Math.max(COLUMN_MIN_PX, Math.ceil(contentWidth));
  const tallOrNarrow = height > width || width < BESIDE_MIN_WIDTH;
  if (tallOrNarrow && height >= BELOW_MIN_HEIGHT) {
    return { placement: "below" };
  }
  if (
    width < BESIDE_MIN_WIDTH ||
    height < BESIDE_MIN_HEIGHT ||
    columnWidth > Math.min(COLUMN_MAX_PX, width * COLUMN_MAX_SHARE) ||
    width - columnWidth < PLOT_KEEPS_PX
  ) {
    return { placement: "overlay" };
  }
  const stacked = height >= PLOT_CHROME_PX + legendHeight + cardHeight;
  if (!stacked && height < PLOT_CHROME_PX + LEGEND_STRIP_PX + cardHeight) {
    return { placement: "overlay" };
  }
  return { placement: "beside", columnWidth, legendBelow: !stacked };
}
