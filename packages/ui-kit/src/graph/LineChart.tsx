import type {
  PlotLayer,
  SeriesBridge,
  SeriesStatusSpan,
} from "@ksp-gonogo/sitrep-sdk";
import React, {
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { InstrumentHeldMark, sayHeld } from "../instrumentCurrency";
import {
  PlotCrosshair,
  type PlotCrosshairRow,
  plotCrosshairCardBox,
} from "../PlotCrosshair";
import { placePlotReadouts } from "../plotReadoutPlacement";
import { resolveCurrency, type UnitValue } from "../readingCurrency";
import { reckoningBasisPhrase } from "../reckoningBasisPhrase";
import { ReckoningMarkSvg } from "../reckoningMarkDraw";
import { VisuallyHidden } from "../VisuallyHidden";
import { boxAsTrace, type PixelBox, placeCard } from "./cardPlacement";
import {
  orderedByX,
  sampleNearest,
  sampleTimes,
  stepTime,
} from "./crosshairMath";
import { LimitCrossingMark } from "./LimitCrossingMark";
import { isPast, type LimitSide, limitCrossings } from "./limitCrossings";
import {
  buildBandPath,
  buildPath,
  buildSegmentedPath,
  buildStepPath,
  buildUncertaintyRegions,
  chordDeparts,
  formatTimeLabel,
  makeLogScale,
  makeScale,
  niceLogTicks,
  niceTicks,
  type SeriesReckonedSpan,
} from "./lineChartMath";
import {
  type PlotLayerFrame,
  PlotLayers,
  plotLayerDescriptions,
  plotLayerExtent,
  solidRegionCover,
} from "./plotLayers";
import { placeThresholdLabels } from "./thresholdLabels";

/**
 * The samples of one line on a graph, as parallel `x` and `y` arrays; `x` is unix ms on a time chart
 * and `y2` is the upper bound of a `band` series. Useful for giving the operator a trace of one
 * reading over time or against another reading. Held in the `data` of a {@link ChartSeries}.
 *
 * `breaks` names indices that open a real hole: `line` and `step` start a fresh subpath there.
 * `spans` records runs that did not arrive live, and they are drawn exactly like live data, because a
 * replayed sample is still a measured one. `reckoned` runs, which a model carried forward, are muted
 * and dashed, and may carry a shaded uncertainty band behind the stroke.
 *
 * @category Graph
 */
export interface ChartSeriesData {
  /** The x of each sample, ascending. */
  x: number[];
  /** The y of each sample, the lower bound of a `band` series. */
  y: number[];
  /** The upper bound of each sample of a `band` series, the same length as `y`. */
  y2?: number[];
  /** Indices into `x` at which a known hole comes before the sample. */
  breaks?: number[];
  /** Runs of samples carrying a server-stamped status other than live. */
  spans?: readonly SeriesStatusSpan[];
  /** Runs of samples a model carried forward rather than measured. */
  reckoned?: readonly SeriesReckonedSpan[];
  /** A model's path through an unobserved gap; drawn instead of the chord when the chord departs from it by more than a pixel. */
  bridges?: readonly SeriesBridge[];
}

const HEAD_MARK_RADIUS = 4;

/** Larger than a scatter dot so it holds its own against the dashed line crossing it. */
const OBSERVED_MARK_RADIUS = 2.5;

/**
 * How one line of a graph is drawn between its samples. Useful for showing a reading that changes
 * continuously as a line, a state that holds until it changes as steps, separate occurrences as
 * points and an envelope as a filled band. Set in the `type` of a {@link ChartSeries}.
 *
 * - `line`: straight segments through every sample (default)
 * - `step`: step-after, for discrete-state telemetry where interpolating between transitions misleads
 * - `scatter`: discrete points, no joining
 * - `band`: filled envelope between `y` (lower) and `y2` (upper), which must be the same length
 *
 * @category Graph
 */
export type SeriesType = "line" | "step" | "scatter" | "band";

/**
 * One line on a graph: its samples, colour, label and the axis it is read against. Useful for
 * showing the operator how one reading has moved, or one curve a widget computed. Passed in the
 * `series` prop of {@link Graph}, which the graph widget fills from the readings it plots.
 *
 * @category Graph
 */
export interface ChartSeries {
  /** Unique within the chart; the line's React key. */
  id: string;
  /** Names the line in the legend and in the chart's accessible name. */
  label: string;
  /** The y axis the line is read against. */
  axis: "primary" | "secondary";
  /** CSS colour of the stroke, such as `var(--color-nogo-mark)`. */
  color: string;
  /** Defaults to `"line"` when omitted. */
  type?: SeriesType;
  /** Render as a dashed line, for reference or target curves. */
  dashed?: boolean;
  /** Fill opacity (0..1) for `band` series. Defaults 0.2. */
  fillOpacity?: number;
  /** Writes one of this series' figures with its unit, for the crosshair readout. Falls back to the axis tick formatter. */
  format?: (y: number) => string;
  /** A mark on the newest sample: a filled dot, or a ring where the figure is held or modelled and so states less than a measurement does. */
  headMark?: "dot" | "ring";
  /** A curve with one figure at every x: the crosshair reads it between its samples, not at the nearest one. */
  readBetween?: boolean;
  /** The line's samples. */
  data: ChartSeriesData;
}

/**
 * What a threshold line on a graph is for, which decides how it is drawn. Useful for telling the
 * operator whether a line is a limit to stay inside, a figure to reach or the place something is
 * now. Set in the `kind` of a {@link GraphThreshold}.
 *
 * - `limit`: a figure not to pass, with the side that is past it declared. Dashed and quiet until a trace on its axis stands at or past it, then in the warning tone, and each place a trace went past it carries a warning mark
 * - `target`: a figure to reach. Dashed and quiet until a trace on its axis has reached it, then in the go tone
 * - `marker`: where something is now. Solid, and never changes tone
 *
 * @category Graph
 */
export type ThresholdKind = "limit" | "target" | "marker";

export type { LimitSide } from "./limitCrossings";

interface ThresholdRuleBase {
  id: string;
  /** Where the line stands, in the axis's unit. */
  value: number;
  /** `"primary"` when omitted. */
  axis?: "primary" | "secondary";
  label?: string;
  /** The label as a screen reader should hear it, with units spelled out. `label` when omitted. */
  spokenLabel?: string;
  /** What the line was drawn from. A held one marks the label, and one a model carried is marked as modelled; the chart's accessible name says which. */
  reading?: UnitValue;
}

/**
 * A horizontal reference line on a graph at one figure on its axis, with an optional label at the
 * right. Useful for showing the operator how far a trace is from the figure that matters. Passed in
 * the `thresholds` prop of {@link Graph}. Its tone comes from `kind` and the plotted data, never
 * from the caller.
 *
 * @category Graph
 */
export type ThresholdRule = ThresholdRuleBase &
  (
    | {
        /** A figure not to pass. */
        kind: "limit";
        /** The side of the line that is out of bounds. */
        bad: LimitSide;
      }
    | {
        /** A figure to reach, or the place something is now. */
        kind: Exclude<ThresholdKind, "limit">;
      }
  );

/** A trace has reached a line when its newest figure is on it, or on the other side of it from its oldest. */
function hasReached(ys: readonly number[], at: number): boolean {
  if (ys.length === 0) return false;
  const newest = ys[ys.length - 1] - at;
  if (newest === 0) return true;
  if (ys.length === 1) return false;
  return Math.sign(ys[0] - at) !== Math.sign(newest);
}

/** The line takes the mark tone, and its label the text tone of the same state: a mark tone is not legible as type. */
function thresholdTone(
  kind: ThresholdKind,
  passed: boolean,
): { line: string; label: string } {
  if (kind === "marker") {
    return {
      line: "var(--color-text-primary)",
      label: "var(--color-text-primary)",
    };
  }
  if (!passed) {
    return {
      line: "var(--color-text-faint)",
      label: "var(--color-text-faint)",
    };
  }
  return kind === "limit"
    ? { line: "var(--color-warn-mark)", label: "var(--color-warn-text)" }
    : { line: "var(--color-go-mark)", label: "var(--color-go-text)" };
}

/**
 * How a y axis maps a figure to a position: evenly (`"linear"`) or by its power of ten (`"log"`).
 * Useful for a reading that spans orders of magnitude, such as pressure up through the atmosphere.
 * Set in the `yScalePrimary` and `yScaleSecondary` props of {@link Graph}.
 *
 * @category Graph
 */
export type AxisScale = "linear" | "log";

/** Default tick formatter for an x-axis representing wall-clock time (unix ms). */
export const timeXTickFormat = (
  value: number,
  domain: readonly [number, number],
): string => formatTimeLabel(value - domain[0], domain[1] - domain[0]);

/**
 * Writes an x tick of a graph whose x axis is universal time in seconds, as elapsed time from the
 * left edge. Useful for labelling a time axis in the game's own clock. Passed as the `xTickFormat`
 * of {@link Graph}; pick it by the basis the producer declared, never by the size of the numbers.
 *
 * @category Graph
 */
export const utXTickFormat = (
  value: number,
  domain: readonly [number, number],
): string =>
  formatTimeLabel((value - domain[0]) * 1000, (domain[1] - domain[0]) * 1000);

/**
 * Props for {@link Graph}. Useful for giving the operator a drawn chart of one or more series
 * with its axes, reference lines and readout. Taken by {@link Graph}.
 *
 * @category Graph
 */
export interface LineChartProps {
  /** The lines to draw. */
  series: ChartSeries[];
  /** x-domain. Interpretation depends on `xTickFormat`: defaults to unix ms. */
  xDomain: [number, number];
  /** Pins the primary y domain; derived from the series and thresholds when absent. */
  yDomainPrimary?: [number, number];
  /** Pins the secondary y domain; derived from the series and thresholds when absent. */
  yDomainSecondary?: [number, number];
  /** Tick label formatter for the x-axis. Defaults to elapsed mm:ss / HH:mm:ss. Writing a tick, it is handed the axis's every tick too, so it can give them the decimals that tell them apart. */
  xTickFormat?: (
    value: number,
    domain: readonly [number, number],
    ticks?: readonly number[],
  ) => string;
  /** Tick label formatter for both y-axes. Defaults to k/M-suffixed numeric. Writing a tick, it is handed that axis's every tick too; any other figure is written alone. */
  yTickFormat?: (value: number, ticks?: readonly number[]) => string;
  /** Linear (default) or log10 scale on each Y axis. */
  yScalePrimary?: AxisScale;
  /** Linear or log10 scale of the secondary y axis; linear when absent. */
  yScaleSecondary?: AxisScale;
  /** Horizontal reference lines drawn across the plot. */
  thresholds?: ReadonlyArray<ThresholdRule>;
  /** `"overlay"` (default) stamps labels top-left on backing chips; `"none"` suppresses them. */
  legend?: "overlay" | "none";
  /** Drop the X tick ladder and its gridlines, for a one-dimensional plot; layers are still placed against the domain. */
  hideXAxis?: boolean;
  /** `"compact"` draws a trend glance: no gutters, tick ladders, gridlines, legend or crosshair, each trace shaded down to the frame's bottom edge, and a marker threshold as a short tick with its label. `"chart"` (the default) draws the full chart. */
  density?: "chart" | "compact";
  /** A view of a place rather than a chart: no tick ladders, content to the frame edges, and equal scale on both axes. */
  spatial?: boolean;
  /** Scales the pitch of a spatial plot's dot lattice from its usual gap, clamped to 0.5 to 2, so the lattice can carry the zoom. */
  gridScale?: number;
  /** Everything drawn beyond the series, in data space. Layers join an auto Y domain and are ignored by a pinned one. */
  layers?: readonly PlotLayer[];
  /** Names what the chart is, before the layers add their own clauses. */
  "aria-label"?: string;
  /**
   * A crosshair that reads every series at one x: on pointer hover, and from
   * the keyboard (the chart takes focus; arrow keys step through the samples,
   * shift for ten at a time, Home and End for the ends, Escape to clear). On a
   * value axis (`xKind`) the samples are looked up by x, wherever they stand in
   * the series. Off by default.
   */
  crosshair?: boolean;
  /**
   * What x is. `"time"` (default) reads a series at its own instants and keeps
   * the holes it declares. `"value"` is any other numeric quantity: a series is
   * read at the sample nearest the line, and only within a few percent of the
   * axis span, so a trace is silent where the craft never was.
   */
  xKind?: "time" | "value";
  /** Writes an x for the crosshair's heading and announcement, when it should differ from a tick label. Defaults to `xTickFormat`. */
  xReadFormat?: (value: number, domain: readonly [number, number]) => string;
  /** Names the x axis, with its unit, under the tick labels. Not drawn on a spatial plot or with `hideXAxis`. */
  xAxisLabel?: string;
  /** Names the primary y axis, with its unit, up the left edge. */
  yAxisLabel?: string;
  /** Names the secondary y axis, with its unit, down the right edge. */
  ySecondaryAxisLabel?: string;
  /**
   * A fixed card drawn over the plot in a corner clear of every trace, line
   * and legend chip, at the size it measures. Drawn in no corner when none is
   * clear. A function is handed the room the plot offers and the form to
   * draw, counting from 0, and is asked for the next form (up to `cardForms`
   * in all) while the one it gave has no clear corner.
   */
  card?:
    | ReactNode
    | ((room: { width: number; height: number; form: number }) => ReactNode);
  /** How many forms `card` can draw, the most spread out first. 1 when omitted. */
  cardForms?: number;
  /** Chart width in pixels. */
  width: number;
  /** Chart height in pixels. */
  height: number;
}

const MARGIN = { top: 10, right: 50, bottom: 28, left: 50 };
/** Shrinks the gutters on a small plot, and drops the right one to a sliver when there is no secondary axis. */
function fitMargins(
  width: number,
  height: number,
  hasSecondary: boolean,
): { top: number; right: number; bottom: number; left: number } {
  const clamp = (lo: number, v: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));
  const left = clamp(30, Math.round(width * 0.18), MARGIN.left);
  return {
    top: MARGIN.top,
    right: hasSecondary ? left : clamp(14, Math.round(width * 0.07), 20),
    bottom: height < 150 ? 20 : MARGIN.bottom,
    left,
  };
}
/** An axis label's width at its 11 px type, with a little room either side. */
const tickLabelPx = (text: string) => text.length * 6.5 + 6;
/** The gap between a y label and the plot it labels. */
const Y_LABEL_INSET = 4;
/** The most of a plot's width its label gutter may take. */
const MAX_GUTTER_SHARE = 0.4;
const SPATIAL_GRID_PITCH_PX = 26;
/** The strip an axis title takes beside or under its tick labels. */
const AXIS_TITLE_PX = 14;
/** The height of one legend chip row, chip and gap. */
const LEGEND_ROW_PX = 16;
/** Space between a legend strip and the chart's edge. */
const LEGEND_STRIP_EDGE_PX = 4;
/** Space between two chips on one strip row. */
const LEGEND_STRIP_GAP_PX = 6;
/** The legend chip's width at its 10 px type, clamped to the room it has. */
const chipWidth = (label: string, room: number) =>
  Math.min(label.length * 6 + 8, room);

/** Where each chip stands on a strip `room` wide, filling a row before starting the next. */
function legendStripRows(
  widths: readonly number[],
  room: number,
): { rows: number; positions: { row: number; x: number }[] } {
  const positions: { row: number; x: number }[] = [];
  let row = 0;
  let x = 0;
  for (const width of widths) {
    if (x > 0 && x + width > room) {
      row += 1;
      x = 0;
    }
    positions.push({ row, x });
    x += width + LEGEND_STRIP_GAP_PX;
  }
  return { rows: widths.length === 0 ? 0 : row + 1, positions };
}

/** The card's inset from the plot's edge, as `placeCard` keeps it. */
const CARD_EDGE_PX = 4;
/** How far a value axis reads a trace from the line, as a share of the axis span. */
const VALUE_READ_SHARE = 0.03;

/** `text` cut to fit `px` at the 10 px type titles use, keeping a trailing unit in parentheses whole where there is room for it. */
function fitTitle(text: string, px: number): string {
  const chars = Math.max(0, Math.floor(px / 6));
  if (text.length <= chars) return text;
  const unitAt = text.lastIndexOf(" (");
  if (unitAt > 0 && text.length - unitAt + 4 <= chars) {
    const room = chars - (text.length - unitAt) - 3;
    return `${text.slice(0, room)}...${text.slice(unitAt)}`;
  }
  return chars < 4 ? "" : `${text.slice(0, chars - 3)}...`;
}

/** The closed regions between each stroked run of a path and `floorY`, for shading under a trace; a break in the path leaves a gap in the shading. */
function areaUnder(d: string, floorY: number): string | null {
  const runs = d.split(/(?=M)/).filter((run) => run.length > 0);
  const regions: string[] = [];
  for (const run of runs) {
    const points = [...run.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)];
    if (points.length < 2) continue;
    const first = points[0];
    const last = points[points.length - 1];
    regions.push(
      `${run.trim()} L${last[1]},${floorY} L${first[1]},${floorY} Z`,
    );
  }
  return regions.length > 0 ? regions.join(" ") : null;
}

/** Inset half a pitch so no dot sits on the frame's own edge. */
function spatialGrid(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  scale = 1,
): Array<{ key: string; x: number; y: number }> {
  const dots: Array<{ key: string; x: number; y: number }> = [];
  const p = SPATIAL_GRID_PITCH_PX * Math.max(0.5, Math.min(2, scale));
  for (let x = x0 + p / 2; x < x1; x += p) {
    for (let y = y0 + p / 2; y < y1; y += p) {
      dots.push({ key: `sg-${Math.round(x)}-${Math.round(y)}`, x, y });
    }
  }
  return dots;
}

/** Below either, captions are dropped; the layer description still reaches a screen reader. */
const CAPTION_MIN_PLOT_W = 120;
const CAPTION_MIN_PLOT_H = 90;
const PX_PER_X_TICK = 70;
const PX_PER_Y_TICK = 35;
const SCATTER_RADIUS = 2;
/** What a card's figure line is sized for: a figure of this many characters and a currency word after it. */
const CARD_FIGURE_CHARS = 14;
const CARD_CURRENCY_CHARS = 10;
/** A stacked card keeps its edge and padding on both sides and a swatch before the text. */
const CARD_PAD_PX = 36;
/** Slack for the gap between the plot and its column, which the chart's own margin does not cover. */
const COLUMN_SLACK_PX = 12;
/** Space between the plot and its readout column, and between the column and the chart edge. */
const COLUMN_GAP = 8;
const COLUMN_EDGE = 2;
/** The limit mark's width, which is also how close two spells may start and still be one mark. */
const LIMIT_MARK_SIZE = 14;
/** A threshold label's width per character and for a held or modelled mark after it, at its 10 px type. */
const LABEL_CHAR_PX = 6;
const LABEL_MARK_PX = 12;
/** How far the mark's centre stands from the crossing, on each axis. */
const LIMIT_MARK_OFFSET = 10;
const DEFAULT_BAND_OPACITY = 0.2;
/** A reckoned run is muted and dashed, never recoloured; 0.6 keeps series colours above 3:1 against the surface. */
const RECKONED_STROKE_OPACITY = 0.6;
const RECKONED_DASHARRAY = "5 3";
/** An uncertainty region takes its own series' colour so a two-series chart still says whose it is. */
const RECKONED_BAND_OPACITY = 0.15;
const RECKONED_BAND_EDGE_OPACITY = 0.45;

const BAND_CLAIM = "the value is inside the shaded region";

/** Pull every plottable Y value out of a series, including band upper bounds. */
function seriesYValues(s: ChartSeries): number[] {
  if ((s.type ?? "line") === "band" && s.data.y2) {
    return [...s.data.y, ...s.data.y2];
  }
  return s.data.y;
}

/** The width the column beside the plot needs to hold its widest line whole: the legend chips and the limit and target captions. */
function readoutColumnWidth({
  series,
  thresholds,
  yTickFormat,
}: {
  series: readonly ChartSeries[];
  thresholds: readonly ThresholdRule[];
  yTickFormat: (v: number) => string;
}): number {
  const px = (chars: number) => chars * LABEL_CHAR_PX;
  const widths: number[] = [];
  for (const s of series) widths.push(px(s.label.length) + 8);
  for (const t of thresholds) {
    if (t.kind === "marker") continue;
    const figure = t.label ?? yTickFormat(t.value);
    widths.push(px(figure.length) + LABEL_MARK_PX + 8);
  }
  return Math.max(0, ...widths) + COLUMN_SLACK_PX;
}

/**
 * A chart drawn at the pixel size it is given: a plot with tick ladders, one or two y axes, reference
 * lines, an optional crosshair that reads every series at one x, and the cards and notices a widget
 * lays over it. Useful for showing the operator how readings move over time or against one another.
 * Used by the graph widget and the flight history list. Width and height are required; a caller that
 * wants it to fill a region measures the region itself.
 *
 * @category Graph
 */
export function LineChart({
  series,
  xDomain,
  yDomainPrimary,
  yDomainSecondary,
  xTickFormat = timeXTickFormat,
  yTickFormat = formatYTick,
  yScalePrimary = "linear",
  yScaleSecondary = "linear",
  thresholds,
  legend: legendProp = "overlay",
  hideXAxis = false,
  density = "chart",
  spatial: spatialProp = false,
  gridScale = 1,
  layers,
  "aria-label": ariaLabel,
  crosshair = false,
  xKind = "time",
  xReadFormat,
  xAxisLabel,
  yAxisLabel,
  ySecondaryAxisLabel,
  card,
  cardForms = 1,
  width,
  height,
}: Readonly<LineChartProps>) {
  const uid = useId();
  const compact = density === "compact";
  const legend = compact ? "none" : legendProp;
  const spatial = spatialProp;
  const bare = spatial || compact;
  // With nothing plotted there is nothing to read, so the chart takes no tab stop.
  const crosshairOn =
    crosshair && !bare && series.some((s) => s.data.x.length > 0);
  const [cursor, setCursor] = useState<{
    at: number;
    source: "pointer" | "keys";
  } | null>(null);
  const [focusRing, setFocusRing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const [formAt, setFormAt] = useState<{
    w: number;
    h: number;
    form: number;
  } | null>(null);
  // A form is tried from the most spread out at each plot size, so a chart resized to a size reads the same as one first drawn there.
  const cardForm = formAt?.w === width && formAt.h === height ? formAt.form : 0;
  const [measured, setMeasured] = useState<{
    w: number;
    h: number;
    form: number;
  } | null>(null);
  const hasCard = card !== undefined && card !== null;
  // The card's own size decides where it fits, so it is rendered first and measured, not given a size by its caller. A size measured for another form says nothing about this one.
  const cardSize = measured?.form === cardForm ? measured : null;
  useLayoutEffect(() => {
    if (!cardEl) {
      setMeasured(null);
      return;
    }
    const read = () =>
      setMeasured((prev) => {
        const next = {
          w: cardEl.offsetWidth,
          h: cardEl.offsetHeight,
          form: cardForm,
        };
        return prev?.w === next.w &&
          prev?.h === next.h &&
          prev?.form === next.form
          ? prev
          : next;
      });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(cardEl);
    return () => ro.disconnect();
  }, [cardEl, cardForm]);
  const w = width;
  const h = height;

  const primarySeries = series.filter(
    (s) => s.axis === "primary" && s.data.x.length > 0,
  );
  const secondarySeries = series.filter(
    (s) => s.axis === "secondary" && s.data.x.length > 0,
  );
  const hasSecondary = secondarySeries.length > 0;

  // The card, legend and captions share one placement: a column beside the plot when the chart has room, the plot itself otherwise.
  // A chart with nothing to read out keeps the whole width for its plot.
  const hasReadouts =
    (legend !== "none" && series.length > 0) ||
    (thresholds ?? []).some((t) => t.label);
  const chipsWidth = readoutColumnWidth({
    series,
    thresholds: thresholds ?? [],
    yTickFormat,
  });
  // The fixed card shares the column only where the column, sized to the legend, is already as wide as the card.
  const cardInColumn =
    hasCard &&
    cardSize !== null &&
    cardSize.w + COLUMN_GAP <= Math.max(112, Math.ceil(chipsWidth));
  const readouts =
    bare || !hasReadouts
      ? ({ placement: "overlay" } as const)
      : placePlotReadouts({
          width: w,
          height: h,
          contentWidth: chipsWidth,
          legendHeight:
            legend === "none" ? 0 : series.length * LEGEND_ROW_PX + 6,
          cardHeight: cardInColumn && cardSize !== null ? cardSize.h : 0,
        });
  const legendBelow =
    legend !== "none" &&
    (readouts.placement === "below" ||
      (readouts.placement === "beside" && readouts.legendBelow));
  const legendStrip = legendBelow
    ? legendStripRows(
        series.map((s) => chipWidth(s.label, w - 2 * LEGEND_STRIP_EDGE_PX)),
        w - 2 * LEGEND_STRIP_EDGE_PX,
      )
    : { rows: 0, positions: [] as { row: number; x: number }[] };
  const legendStripH =
    legendStrip.rows === 0 ? 0 : legendStrip.rows * LEGEND_ROW_PX + 4;

  const titledX = !bare && !hideXAxis && !!xAxisLabel;
  const titledY = !bare && !!yAxisLabel;
  const titledSecondary = !bare && hasSecondary && !!ySecondaryAxisLabel;
  // One pixel of inset keeps the outermost stroke from being clipped by the frame.
  const base = bare
    ? { top: 1, right: 1, bottom: 1, left: 1 }
    : fitMargins(w, h, hasSecondary);
  const fitted = {
    ...base,
    bottom: base.bottom + (titledX ? AXIS_TITLE_PX : 0) + legendStripH,
  };
  const plotY0 = fitted.top;
  const plotY1 = h - fitted.bottom;
  const plotH = plotY1 - plotY0;

  const layerYs = useMemo(() => {
    const out = { primary: [] as number[], secondary: [] as number[] };
    for (const layer of layers ?? []) {
      const extent = plotLayerExtent(layer);
      out[extent.axis].push(...extent.ys);
    }
    return out;
  }, [layers]);

  const primaryDomain = useMemo(
    (): [number, number] =>
      computeYDomain(
        primarySeries,
        yDomainPrimary,
        yScalePrimary,
        layerYs.primary,
      ),
    [primarySeries, yDomainPrimary, yScalePrimary, layerYs],
  );

  const secondaryDomain = useMemo(
    (): [number, number] =>
      computeYDomain(
        secondarySeries,
        yDomainSecondary,
        yScaleSecondary,
        layerYs.secondary,
      ),
    [secondarySeries, yDomainSecondary, yScaleSecondary, layerYs],
  );

  const scaleYPrimary =
    yScalePrimary === "log"
      ? makeLogScale(primaryDomain[0], primaryDomain[1], plotY1, plotY0)
      : makeScale(primaryDomain[0], primaryDomain[1], plotY1, plotY0);
  const scaleYSecondary =
    yScaleSecondary === "log"
      ? makeLogScale(secondaryDomain[0], secondaryDomain[1], plotY1, plotY0)
      : makeScale(secondaryDomain[0], secondaryDomain[1], plotY1, plotY0);

  const yTickCount = Math.max(
    2,
    Math.min(7, Math.round(plotH / PX_PER_Y_TICK)),
  );
  // Nice rounding can land every tick outside a narrow domain, so keep in-domain ticks and retry finer before falling back to the endpoints.
  const axisTicks = (
    d0: number,
    d1: number,
    count: number,
    kind: "linear" | "log",
  ): number[] => {
    const lo = Math.min(d0, d1);
    const hi = Math.max(d0, d1);
    const eps = (hi - lo) * 1e-6 || 1e-6;
    const inDomain = (t: number) => t >= lo - eps && t <= hi + eps;
    const gen = (n: number) =>
      kind === "log" ? niceLogTicks(lo, hi, n) : niceTicks(lo, hi, n);
    for (let n = count; n <= 64; n *= 2) {
      const inView = gen(n).filter(inDomain);
      // A single tick is not a scale.
      if (inView.length < 2) continue;
      // Thin a finer retry back to about `count` evenly spaced ticks.
      if (inView.length <= count) return inView;
      const stepIdx = (inView.length - 1) / (count - 1);
      const picked = Array.from(
        { length: count },
        (_, i) => inView[Math.round(i * stepIdx)],
      );
      return Array.from(new Set(picked));
    }
    return [lo, hi];
  };
  const yTicksPrimary = axisTicks(
    primaryDomain[0],
    primaryDomain[1],
    yTickCount,
    yScalePrimary === "log" ? "log" : "linear",
  );
  const yTicksSecondary = !hasSecondary
    ? []
    : axisTicks(
        secondaryDomain[0],
        secondaryDomain[1],
        yTickCount,
        yScaleSecondary === "log" ? "log" : "linear",
      );

  // A gutter is never narrower than the longest label it carries, so a small plot does not clip "500 m" to "00 m"; it still leaves most of the width to the plot.
  const labelGutter = (ticks: number[], least: number) =>
    ticks.length === 0
      ? least
      : Math.max(
          least,
          Math.min(
            Math.round(w * MAX_GUTTER_SHARE),
            Math.max(...ticks.map((t) => tickLabelPx(yTickFormat(t, ticks)))) +
              Y_LABEL_INSET,
          ),
        );
  const margin = bare
    ? fitted
    : {
        ...fitted,
        left:
          labelGutter(yTicksPrimary, fitted.left) +
          (titledY ? AXIS_TITLE_PX : 0),
        right:
          (hasSecondary
            ? labelGutter(yTicksSecondary, fitted.right)
            : fitted.right) + (titledSecondary ? AXIS_TITLE_PX : 0),
      };
  const plotX0 = margin.left;
  const columnWidth =
    readouts.placement === "beside" ? readouts.columnWidth : 0;
  const plotX1 = w - margin.right - columnWidth;
  const plotW = plotX1 - plotX0;
  const captionsFit =
    plotW >= CAPTION_MIN_PLOT_W && plotH >= CAPTION_MIN_PLOT_H;
  const column =
    columnWidth > 0
      ? {
          // A second axis writes its ticks in the margin, so the column starts past them.
          x0: plotX1 + (hasSecondary ? margin.right : 0) + COLUMN_GAP,
          y0: plotY0,
          x1: w - COLUMN_EDGE,
          y1: plotY1,
        }
      : undefined;
  // Chips standing over the plot are somewhere the crosshair's card keeps off.
  const legendBoxes =
    legend === "none" || column || legendBelow
      ? []
      : series.map((s, i) => ({
          x0: plotX0 + 3,
          y0: plotY0 + 6 + i * LEGEND_ROW_PX,
          x1: plotX0 + 3 + chipWidth(s.label, plotW - 6),
          y1: plotY0 + 6 + i * LEGEND_ROW_PX + 13,
        }));
  const scaleX = makeScale(xDomain[0], xDomain[1], plotX0, plotX1);
  const xTickCount = Math.max(
    2,
    Math.min(8, Math.round(plotW / PX_PER_X_TICK)),
  );
  const xTicks = axisTicks(xDomain[0], xDomain[1], xTickCount, "linear");

  // Labels are thinned so none overlap or clip; the endpoints are edge-anchored.
  const xTickLabels = useMemo(() => {
    const out: {
      x: number;
      text: string;
      anchor: "start" | "middle" | "end";
    }[] = [];
    const last = xTicks.length - 1;
    if (last < 0) return out;
    const estPx = tickLabelPx;
    const gap = 6;
    const make = (idx: number) => {
      const tick = xTicks[idx];
      const text = xTickFormat(tick, xDomain, xTicks);
      const x = scaleX(tick);
      const wpx = estPx(text);
      const anchor: "start" | "middle" | "end" =
        idx === 0 ? "start" : idx === last ? "end" : "middle";
      const leftEdge =
        anchor === "start" ? x : anchor === "end" ? x - wpx : x - wpx / 2;
      return { x, text, anchor, leftEdge, rightEdge: leftEdge + wpx };
    };
    const first = make(0);
    out.push({ x: first.x, text: first.text, anchor: first.anchor });
    if (last >= 1) {
      const end = make(last);
      if (end.leftEdge >= first.rightEdge + gap) {
        let prevRight = first.rightEdge;
        for (let i = 1; i < last; i++) {
          const m = make(i);
          if (
            m.leftEdge >= prevRight + gap &&
            m.rightEdge <= end.leftEdge - gap
          ) {
            out.push({ x: m.x, text: m.text, anchor: m.anchor });
            prevRight = m.rightEdge;
          }
        }
        out.push({ x: end.x, text: end.text, anchor: end.anchor });
      }
    }
    return out;
  }, [xTicks, xDomain, scaleX, xTickFormat]);

  const yLabelKeep = (ticks: number[], pos: (t: number) => number) => {
    const keep = new Set<number>();
    const n = ticks.length;
    if (n === 0) return keep;
    keep.add(0);
    if (n === 1) return keep;
    const MIN = 16; // min center-to-center px so 11px labels never touch
    const p0 = pos(ticks[0]);
    const pLast = pos(ticks[n - 1]);
    if (Math.abs(pLast - p0) >= MIN) {
      let prev = p0;
      for (let i = 1; i < n - 1; i++) {
        const p = pos(ticks[i]);
        if (Math.abs(p - prev) >= MIN && Math.abs(pLast - p) >= MIN) {
          keep.add(i);
          prev = p;
        }
      }
      keep.add(n - 1);
    }
    return keep;
  };
  const yKeepPrimary = yLabelKeep(yTicksPrimary, scaleYPrimary);
  const yKeepSecondary = yLabelKeep(yTicksSecondary, scaleYSecondary);

  const drawables = useMemo(() => {
    return series
      .filter((s) => s.data.x.length > 0)
      .map((s) => {
        const scaleY = s.axis === "primary" ? scaleYPrimary : scaleYSecondary;
        const type = s.type ?? "line";
        if (type === "band") {
          if (!s.data.y2) {
            return {
              id: s.id,
              kind: "noop" as const,
            };
          }
          return {
            id: s.id,
            kind: "band" as const,
            color: s.color,
            opacity: s.fillOpacity ?? DEFAULT_BAND_OPACITY,
            d: buildBandPath(s.data.x, s.data.y, s.data.y2, scaleX, scaleY),
          };
        }
        if (type === "scatter") {
          const points = s.data.x.map((xv, i) => ({
            cx: scaleX(xv),
            cy: scaleY(s.data.y[i]),
          }));
          return {
            id: s.id,
            kind: "scatter" as const,
            color: s.color,
            points,
          };
        }
        const builder = type === "step" ? buildStepPath : buildPath;
        const contradicted = (s.data.bridges ?? []).filter((bridge) =>
          chordDeparts(s.data.x, s.data.y, bridge, scaleX, scaleY),
        );
        const breaks = [
          ...new Set([
            ...(s.data.breaks ?? []),
            ...contradicted.map((bridge) => bridge.to),
          ]),
        ].sort((a, b) => a - b);
        return {
          id: s.id,
          kind: "stroked" as const,
          color: s.color,
          dashed: s.dashed ?? false,
          uncertainty: buildUncertaintyRegions(
            s.data.x,
            s.data.reckoned ?? [],
            scaleX,
            scaleY,
          ),
          segments: buildSegmentedPath(
            s.data.x,
            s.data.y,
            scaleX,
            scaleY,
            builder,
            breaks,
            s.data.spans,
            s.data.reckoned,
          ),
          modelled: contradicted.map((bridge) => ({
            basis: bridge.basis,
            d: buildPath(
              [s.data.x[bridge.to - 1], ...bridge.t, s.data.x[bridge.to]],
              [s.data.y[bridge.to - 1], ...bridge.v, s.data.y[bridge.to]],
              scaleX,
              scaleY,
            ),
          })),
          // Where the trace ends on a model's figure: the kit's modelled mark, so a reckoned tail reads as modelled and not only as a dashed line.
          tail:
            s.data.x.length > 0 &&
            (s.data.reckoned ?? []).some((run) => run.to >= s.data.x.length - 1)
              ? {
                  cx: scaleX(s.data.x[s.data.x.length - 1]),
                  cy: scaleY(s.data.y[s.data.y.length - 1]),
                }
              : null,
          observed: [
            ...new Set(
              contradicted.flatMap((bridge) => [bridge.to - 1, bridge.to]),
            ),
          ].map((i) => ({
            cx: scaleX(s.data.x[i]),
            cy: scaleY(s.data.y[i]),
          })),
        };
      });
  }, [series, scaleX, scaleYPrimary, scaleYSecondary]);

  const thresholdLines = useMemo(() => {
    if (!thresholds) return [];
    return thresholds.map((t) => {
      const axis = t.axis ?? "primary";
      // A marker has nothing to pass, and a dashed series is a reference curve, not a trace of the craft.
      const traces = series.filter(
        (s) => s.axis === axis && s.type !== "band" && !s.dashed,
      );
      const passed =
        t.kind === "limit"
          ? // Where the figure stands now decides it, so one that has been past the limit for the whole window is past it.
            traces.some((s) => {
              const finite = s.data.y.filter((y) => Number.isFinite(y));
              return (
                finite.length > 0 &&
                isPast(finite[finite.length - 1], t.value, t.bad)
              );
            })
          : t.kind === "target" &&
            traces.some((s) => hasReached(s.data.y, t.value));
      return {
        id: t.id,
        label: t.label,
        spokenLabel: t.spokenLabel,
        value: t.value,
        kind: t.kind,
        passed,
        // The line stands where the reading's model has it, so a figure carried forward is marked as that.
        currency: resolveCurrency(t.reading, { drawsReckoning: true }),
        tone: thresholdTone(t.kind, passed),
        dashed: t.kind !== "marker",
        y:
          axis === "primary"
            ? scaleYPrimary(t.value)
            : scaleYSecondary(t.value),
      };
    });
  }, [thresholds, series, scaleYPrimary, scaleYSecondary]);

  // One mark per spell a trace spent past a limit, at the spell's start, set off to the bad side and back from the crossing so it covers neither the trace nor the line.
  const crossingMarks = useMemo(() => {
    const clamp = (lo: number, v: number, hi: number) =>
      Math.max(lo, Math.min(hi, v));
    return (thresholds ?? []).flatMap((t) => {
      if (t.kind !== "limit" || !Number.isFinite(t.value)) return [];
      const axis = t.axis ?? "primary";
      const scaleY = axis === "primary" ? scaleYPrimary : scaleYSecondary;
      const limitY = scaleY(t.value);
      const away = t.bad === "above" ? -1 : 1;
      const limitName = t.label || `the limit at ${yTickFormat(t.value)}`;
      return series
        .filter(
          (s) =>
            s.axis === axis &&
            s.data.x.length > 0 &&
            (s.type ?? "line") !== "band" &&
            !s.dashed,
        )
        .flatMap((s) =>
          limitCrossings({
            y: s.data.y,
            cx: s.data.x.map(scaleX),
            cy: s.data.y.map(scaleY),
            limit: t.value,
            limitY,
            bad: t.bad,
            breaks: s.data.breaks,
            step: s.type === "step" || s.type === "scatter",
            minGapPx: LIMIT_MARK_SIZE,
          })
            // A plot too small for captions has room for one mark a trace: where its newest spell began.
            .slice(captionsFit ? 0 : -1)
            .map((crossing) => {
              const reading = yTickFormat(s.data.y[crossing.index]);
              const when = xTickFormat(s.data.x[crossing.index], xDomain);
              return {
                key: `${t.id}-${s.id}-${crossing.index}`,
                color: s.color,
                x: clamp(
                  plotX0 + LIMIT_MARK_SIZE / 2 + 1,
                  crossing.x - LIMIT_MARK_OFFSET * (crossing.entered ? 1 : -1),
                  plotX1 - LIMIT_MARK_SIZE / 2 - 1,
                ),
                y: clamp(
                  plotY0 + LIMIT_MARK_SIZE / 2 + 1,
                  crossing.y + away * LIMIT_MARK_OFFSET,
                  plotY1 - LIMIT_MARK_SIZE / 2 - 1,
                ),
                text: crossing.entered
                  ? crossing.spells > 1
                    ? `${s.label} went past ${limitName} ${crossing.spells} times from ${when}, first reading ${reading}`
                    : `${s.label} went past ${limitName} at ${when}, reading ${reading}`
                  : `${s.label} was already past ${limitName} when this window began at ${when}, reading ${reading}`,
              };
            }),
        );
    });
  }, [
    thresholds,
    series,
    scaleX,
    scaleYPrimary,
    scaleYSecondary,
    xTickFormat,
    yTickFormat,
    xDomain,
    plotX0,
    plotX1,
    plotY0,
    plotY1,
    captionsFit,
  ]);

  // The card is placed before the threshold labels, which then yield to it: a label is short and can move, a card cannot.
  const cardBox: PixelBox | undefined = (() => {
    if (!hasCard || cardSize === null || bare) return undefined;
    // In the column the card stands at the foot, below the legend chips.
    if (column && cardInColumn) {
      const box = {
        x0: column.x0,
        y0: plotY1 - cardSize.h,
        x1: column.x0 + cardSize.w,
        y1: plotY1,
      };
      const legendFoot =
        plotY0 +
        (legend === "none" || legendBelow
          ? 0
          : series.length * LEGEND_ROW_PX + 6);
      return box.x1 <= column.x1 && box.y0 >= legendFoot ? box : undefined;
    }
    const half = LIMIT_MARK_SIZE / 2;
    const traces = [
      ...series
        .filter((s) => (s.type ?? "line") !== "band")
        .flatMap((s) => {
          const scaleY = s.axis === "primary" ? scaleYPrimary : scaleYSecondary;
          const cx = s.data.x.map(scaleX);
          const cy = s.data.y.map(scaleY);
          // Dots are not joined, so each is its own obstacle.
          return s.type === "scatter"
            ? cx.map((px, i) => ({ cx: [px], cy: [cy[i]] }))
            : [{ cx, cy }];
        }),
      ...thresholdLines.map((t) => ({ cx: [plotX0, plotX1], cy: [t.y, t.y] })),
    ];
    const obstacles: PixelBox[] = [
      ...crossingMarks.map((m) => ({
        x0: m.x - half,
        y0: m.y - half,
        x1: m.x + half,
        y1: m.y + half,
      })),
      ...(legend === "none" || column || legendBelow
        ? []
        : series.map((s, i) => ({
            x0: plotX0 + 3,
            y0: plotY0 + 6 + i * 16,
            x1: plotX0 + 3 + Math.min(s.label.length * 6 + 8, plotW - 6),
            y1: plotY0 + 6 + i * 16 + 13,
          }))),
    ];
    const at = placeCard({
      plot: { x0: plotX0, y0: plotY0, x1: plotX1, y1: plotY1 },
      card: { width: cardSize.w, height: cardSize.h },
      traces,
      obstacles,
    });
    return at
      ? { x0: at.x, y0: at.y, x1: at.x + cardSize.w, y1: at.y + cardSize.h }
      : undefined;
  })();
  // A label yields to another label always, and to a mark, the legend and a trace where it can. A plot too small for captions draws none: the lines and the marks stand alone.
  const labelPlaces = useMemo(() => {
    if (!captionsFit) return new Map<string, null>();
    const half = LIMIT_MARK_SIZE / 2;
    return placeThresholdLabels({
      labels: thresholdLines
        .filter((t) => t.label)
        .map((t) => ({
          id: t.id,
          width:
            (t.label?.length ?? 0) * LABEL_CHAR_PX +
            (t.currency.held ? LABEL_MARK_PX : 0),
          lineY: t.y,
        })),
      plot: column ?? { x0: plotX0, y0: plotY0, x1: plotX1, y1: plotY1 },
      obstacles: [
        ...(cardBox ? [cardBox] : []),
        ...crossingMarks.map((m) => ({
          x0: m.x - half,
          y0: m.y - half,
          x1: m.x + half,
          y1: m.y + half,
        })),
        ...(legend === "none" || legendBelow
          ? []
          : series.map((s, i) => ({
              x0: column ? column.x0 : plotX0 + 3,
              y0: plotY0 + 6 + i * 16,
              x1:
                (column ? column.x0 : plotX0 + 3) +
                Math.min(
                  s.label.length * 6 + 8,
                  column ? column.x1 - column.x0 : plotW - 6,
                ),
              y1: plotY0 + 6 + i * 16 + 13,
            }))),
      ],
      traces: (column ? [] : series)
        .filter((s) => (s.type ?? "line") !== "band")
        .map((s) => ({
          cx: s.data.x.map(scaleX),
          cy: s.data.y.map(
            s.axis === "primary" ? scaleYPrimary : scaleYSecondary,
          ),
        })),
    });
  }, [
    captionsFit,
    cardBox,
    column,
    thresholdLines,
    crossingMarks,
    legend,
    legendBelow,
    series,
    scaleX,
    scaleYPrimary,
    scaleYSecondary,
    plotX0,
    plotX1,
    plotY0,
    plotY1,
    plotW,
  ]);

  /*
   * Shape and dash are not channels a screen reader has, so each layer and each reckoned run adds a
   * clause to the accessible name. Replayed spans add none, since the trace does not mark them either.
   */
  const reckonedClauses = series.flatMap((s) => {
    const drawn = drawables.find((d) => d.id === s.id);
    const modelled =
      drawn?.kind === "stroked" ? drawn.modelled.map((path) => path.basis) : [];
    const runs = s.data.reckoned ?? [];
    if (runs.length === 0 && modelled.length === 0) return [];
    const bases = new Set([...runs.map((run) => run.basis), ...modelled]);
    const clauses = [...bases].map(
      (basis) =>
        `${s.label}: part of this trace is reckoned, ${reckoningBasisPhrase(basis)}, not measured`,
    );
    if (runs.some((run) => run.bandLo && run.bandHi)) {
      clauses.push(`${s.label}: ${BAND_CLAIM}`);
    }
    return clauses;
  });

  // Tone is not a channel a screen reader has either, so a passed limit and a reached target each say so.
  const thresholdClauses = thresholdLines.flatMap((t) => {
    const name = t.spokenLabel ?? t.label ?? t.id;
    const clauses: string[] = [];
    if (t.passed && t.kind === "limit") clauses.push(`${name}: limit passed`);
    if (t.passed && t.kind === "target")
      clauses.push(`${name}: target reached`);
    if (t.currency.held) clauses.push(sayHeld(name, t.currency.caption));
    // A label with no room to be drawn is still said.
    if (t.label && !labelPlaces.get(t.id) && clauses.length === 0)
      clauses.push(t.spokenLabel ?? t.label);
    return clauses;
  });

  // What differs from a plain measured chart: the one thing a hover has to say, since the accessible name already says the rest.
  const stateClauses = [...reckonedClauses, ...thresholdClauses];
  const chartLabel = [
    ariaLabel ?? "Telemetry line chart",
    ...plotLayerDescriptions(layers ?? []),
    ...stateClauses,
  ].join("; ");

  const crosshairSeries = useMemo(
    () =>
      series
        .filter((s) => s.data.x.length > 0)
        .map((s) => (xKind === "value" ? orderedByX(s) : s)),
    [series, xKind],
  );
  const crosshairTimes = useMemo(
    () => (crosshairOn ? sampleTimes(crosshairSeries) : []),
    [crosshairOn, crosshairSeries],
  );
  const xLo = Math.min(xDomain[0], xDomain[1]);
  const xHi = Math.max(xDomain[0], xDomain[1]);
  const readWithin =
    xKind === "value" ? (xHi - xLo) * VALUE_READ_SHARE : undefined;

  /** Every series' figure at `at`, and the limits, with the words that name the instant. */
  function readAt(at: number): { heading: string; rows: PlotCrosshairRow[] } {
    const rows: PlotCrosshairRow[] = crosshairSeries.map((s) => {
      const sample = sampleNearest(s, at, readWithin);
      const write = s.format ?? yTickFormat;
      const scaleY = s.axis === "primary" ? scaleYPrimary : scaleYSecondary;
      const isBand = (s.type ?? "line") === "band";
      if (sample === null) {
        return { id: s.id, label: s.label, color: s.color, value: null };
      }
      return {
        id: s.id,
        label: s.label,
        color: s.color,
        value:
          isBand && sample.y2 !== undefined
            ? `${write(sample.y)} to ${write(sample.y2)}`
            : write(sample.y),
        // A measurement is the unremarkable case and is not written out; only a state that differs from it is.
        currency: sample.currency === "measured" ? undefined : sample.currency,
        modelled: sample.currency === "modelled",
        y: isBand ? undefined : scaleY(sample.y),
      };
    });
    if (captionsFit) {
      for (const t of thresholdLines) {
        if (t.kind === "marker") continue;
        rows.push({
          id: `threshold-${t.id}`,
          label: t.kind,
          color: t.tone.label,
          value: t.label ?? yTickFormat(t.value),
          detail: true,
          currency: t.currency.held
            ? t.currency.mark === "modelled"
              ? "modelled"
              : "held"
            : undefined,
          modelled: t.currency.held && t.currency.mark === "modelled",
        });
      }
    }
    return { heading: (xReadFormat ?? xTickFormat)(at, xDomain), rows };
  }

  function sayReading(at: number): string {
    const { heading, rows } = readAt(at);
    return [
      heading,
      ...rows.map(
        (row) =>
          `${row.label} ${row.value ?? "no sample"}${row.currency ? `, ${row.currency}` : ""}`,
      ),
    ].join("; ");
  }

  const tracePixels = series
    .filter((s) => (s.type ?? "line") !== "band")
    .map((s) => ({
      cx: s.data.x.map(scaleX),
      cy: s.data.y.map(s.axis === "primary" ? scaleYPrimary : scaleYSecondary),
    }));
  const cardTraces = cardBox
    ? [...tracePixels, boxAsTrace(cardBox)]
    : tracePixels;

  // The next form is tried once this one is measured and has no clear corner.
  const needsNextForm =
    hasCard &&
    !bare &&
    cardSize !== null &&
    // A card that measures nothing (not laid out) says nothing about which form fits.
    cardSize.w > 0 &&
    cardSize.h > 0 &&
    !cardBox &&
    cardForm < cardForms - 1;
  useLayoutEffect(() => {
    if (needsNextForm) setFormAt({ w: width, h: height, form: cardForm + 1 });
  }, [needsNextForm, width, height, cardForm]);
  // The line stands on a sample the way the keys put it, so the instant it names is a sample's own time and does not depend on where the plot's pixels fall.
  const snapped = (at: number): number => {
    let best = at;
    let gap = Number.POSITIVE_INFINITY;
    for (const t of crosshairTimes) {
      if (t < xLo || t > xHi) continue;
      if (Math.abs(t - at) < gap) {
        gap = Math.abs(t - at);
        best = t;
      }
    }
    return best;
  };
  const cursorAt =
    crosshairOn && cursor !== null && cursor.at >= xLo && cursor.at <= xHi
      ? snapped(cursor.at)
      : null;
  const crosshairReading = cursorAt === null ? null : readAt(cursorAt);
  /*
   * The readout takes a corner clear of the fixed card when one exists. Where
   * the one it takes lands on the card, the card gives way for as long as the
   * crosshair is up, so what the operator points at is never covered.
   */
  const crosshairRect =
    crosshairReading !== null && cursorAt !== null
      ? plotCrosshairCardBox({
          x: scaleX(cursorAt),
          plot: { x0: plotX0, y0: plotY0, x1: plotX1, y1: plotY1 },
          heading: crosshairReading.heading,
          rows: crosshairReading.rows,
          avoid: legendBoxes,
          traces: cardTraces,
        })
      : undefined;
  const cardYields =
    cardBox !== undefined &&
    crosshairRect !== undefined &&
    crosshairRect.x0 < cardBox.x1 &&
    crosshairRect.x1 > cardBox.x0 &&
    crosshairRect.y0 < cardBox.y1 &&
    crosshairRect.y1 > cardBox.y0;

  function timeAtPointer(e: React.PointerEvent<SVGSVGElement>): number | null {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    if (px < plotX0 || px > plotX1) return null;
    return (
      xDomain[0] +
      ((px - plotX0) / (plotX1 - plotX0)) * (xDomain[1] - xDomain[0])
    );
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const at = timeAtPointer(e);
    if (at === null) {
      setCursor((c) => (c?.source === "pointer" ? null : c));
      return;
    }
    setCursor({ at, source: "pointer" });
  }

  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    const inView = crosshairTimes.filter((t) => t >= xLo && t <= xHi);
    const steps: Record<string, number> = {
      ArrowLeft: e.shiftKey ? -10 : -1,
      ArrowRight: e.shiftKey ? 10 : 1,
      Home: -inView.length,
      End: inView.length,
    };
    if (e.key === "Escape") {
      if (cursor === null) return;
      e.preventDefault();
      setCursor(null);
      setAnnouncement("");
      return;
    }
    const stride = steps[e.key];
    if (stride === undefined) return;
    e.preventDefault();
    const next = stepTime(inView, cursorAt, stride);
    if (next === null) return;
    setCursor({ at: next, source: "keys" });
    setAnnouncement(sayReading(next));
  }

  function onFocus(e: React.FocusEvent<SVGSVGElement>) {
    try {
      setFocusRing(e.currentTarget.matches(":focus-visible"));
    } catch {
      setFocusRing(true);
    }
    if (cursor !== null) return;
    const newest = stepTime(
      crosshairTimes.filter((t) => t >= xLo && t <= xHi),
      null,
      0,
    );
    if (newest === null) return;
    setCursor({ at: newest, source: "keys" });
    setAnnouncement(sayReading(newest));
  }

  function onBlur() {
    setFocusRing(false);
    setCursor((c) => (c?.source === "keys" ? null : c));
    setAnnouncement("");
  }

  const crosshairProps = crosshairOn
    ? {
        tabIndex: 0,
        onPointerMove,
        onPointerLeave: () =>
          setCursor((c) => (c?.source === "pointer" ? null : c)),
        onKeyDown,
        onFocus,
        onBlur,
      }
    : {};

  const layerFrame: PlotLayerFrame = {
    scaleX,
    scaleYPrimary,
    scaleYSecondary,
    plotX0,
    plotX1,
    plotY0,
    plotY1,
    uid,
    labels: captionsFit,
  };
  /** The lattice is open space only: a dot on the ground would read as a mark on it. */
  const onSolid =
    spatial && layers ? solidRegionCover(layers, layerFrame) : () => false;
  const layerClipId = `plot-layer-clip-${uid}`;

  // Negative rect dimensions spam the console.
  if (plotW <= 0 || plotH <= 0) {
    return (
      <svg
        width={Math.max(0, w)}
        height={Math.max(0, h)}
        role="img"
        aria-label="Chart too small to render"
        style={{ display: "block" }}
      >
        <title>Chart too small to render</title>
      </svg>
    );
  }

  const chart = (
    <svg
      width={w}
      height={h}
      // An image has no parts a reader can reach, so a chart carrying marks that each say something is a group.
      role={crossingMarks.length > 0 || crosshairOn ? "group" : "img"}
      aria-label={chartLabel}
      aria-describedby={crosshairOn ? `${uid}-crosshair-hint` : undefined}
      {...crosshairProps}
      // display: block stops the inline baseline gap feeding the ResizeObserver a growing height.
      style={{
        fontFamily: "var(--font-family-mono)",
        overflow: "visible",
        display: "block",
        ...(crosshairOn
          ? {
              touchAction: "pan-y",
              outline: focusRing ? "2px solid var(--color-focus)" : "none",
              outlineOffset: 2,
            }
          : {}),
      }}
    >
      {layers && layers.length > 0 && (
        <defs>
          <clipPath id={layerClipId}>
            <rect x={plotX0} y={plotY0} width={plotW} height={plotH} />
          </clipPath>
        </defs>
      )}
      {/* A hover only where a mark needs one: a held or modelled figure says why, and a chart with nothing to say draws no native tooltip. */}
      {stateClauses.length > 0 && <title>{stateClauses.join("; ")}</title>}
      <rect
        x={plotX0}
        y={plotY0}
        width={plotW}
        height={plotH}
        fill="var(--color-surface-panel)"
      />

      {/* Under the gridlines so a contributed wash can never bury the axes. */}
      {layers && layers.length > 0 && (
        <g clipPath={`url(#${layerClipId})`}>
          <PlotLayers layers={layers} frame={layerFrame} pass="background" />
        </g>
      )}

      {/* Keyed by index: niceTicks repeats ticks on a zero-span domain. */}
      {!bare &&
        yTicksPrimary.map((tick, idx) => {
          const y = scaleYPrimary(tick);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: tick position IS identity; niceTicks may emit duplicate values for zero-span domains
            <React.Fragment key={`py-${idx}`}>
              <line
                x1={plotX0}
                y1={y}
                x2={plotX1}
                y2={y}
                stroke="var(--color-border-subtle)"
                strokeWidth={1}
              />
              {yKeepPrimary.has(idx) && (
                <text
                  x={plotX0 - 4}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--color-text-faint)"
                  fontSize={11}
                >
                  {yTickFormat(tick, yTicksPrimary)}
                </text>
              )}
            </React.Fragment>
          );
        })}

      {!bare &&
        yTicksSecondary.map((tick, idx) =>
          yKeepSecondary.has(idx) ? (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: tick position IS identity; niceTicks may emit duplicate values for zero-span domains
              key={`sy-${idx}`}
              x={plotX1 + 4}
              y={scaleYSecondary(tick)}
              textAnchor="start"
              dominantBaseline="middle"
              fill="var(--color-text-faint)"
              fontSize={11}
            >
              {yTickFormat(tick, yTicksSecondary)}
            </text>
          ) : null,
        )}

      {!hideXAxis &&
        !bare &&
        xTicks.map((tick, idx) => (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: tick position IS identity; niceTicks may emit duplicate values for zero-span domains
            key={`xg-${idx}`}
            x1={scaleX(tick)}
            y1={plotY0}
            x2={scaleX(tick)}
            y2={plotY1}
            stroke="var(--color-border-subtle)"
            strokeWidth={1}
          />
        ))}

      {!hideXAxis &&
        !bare &&
        xTickLabels.map((lbl, idx) => (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: label position IS identity
            key={`xl-${idx}`}
            x={lbl.x}
            y={plotY1 + 14}
            textAnchor={lbl.anchor}
            fill="var(--color-text-faint)"
            fontSize={11}
          >
            {lbl.text}
          </text>
        ))}

      {titledX && (
        <text
          x={(plotX0 + plotX1) / 2}
          y={h - legendStripH - 5}
          textAnchor="middle"
          fill="var(--color-text-muted)"
          fontSize={10}
          data-axis-title="x"
        >
          {fitTitle(xAxisLabel as string, plotW)}
        </text>
      )}
      {titledY && (
        <text
          x={AXIS_TITLE_PX / 2}
          y={(plotY0 + plotY1) / 2}
          transform={`rotate(-90 ${AXIS_TITLE_PX / 2} ${(plotY0 + plotY1) / 2})`}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--color-text-muted)"
          fontSize={10}
          data-axis-title="y"
        >
          {fitTitle(yAxisLabel as string, plotH)}
        </text>
      )}
      {titledSecondary && (
        <text
          x={w - AXIS_TITLE_PX / 2}
          y={(plotY0 + plotY1) / 2}
          transform={`rotate(90 ${w - AXIS_TITLE_PX / 2} ${(plotY0 + plotY1) / 2})`}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--color-text-muted)"
          fontSize={10}
          data-axis-title="y2"
        >
          {fitTitle(ySecondaryAxisLabel as string, plotH)}
        </text>
      )}

      {/* An even lattice at a fixed screen pitch, not on tick positions, so it reads as a map grid. */}
      {spatial &&
        spatialGrid(plotX0, plotX1, plotY0, plotY1, gridScale)
          .filter((dot) => !onSolid(dot.x, dot.y))
          .map((dot) => (
            <circle
              key={dot.key}
              cx={dot.x}
              cy={dot.y}
              r={1}
              fill="var(--color-text-faint)"
              opacity={0.35}
            />
          ))}

      {!bare && (
        <>
          <line
            x1={plotX0}
            y1={plotY0}
            x2={plotX0}
            y2={plotY1}
            stroke="var(--color-border-strong)"
            strokeWidth={1}
          />
          <line
            x1={plotX0}
            y1={plotY1}
            x2={plotX1}
            y2={plotY1}
            stroke="var(--color-border-strong)"
            strokeWidth={1}
          />
          {hasSecondary && (
            <line
              x1={plotX1}
              y1={plotY0}
              x2={plotX1}
              y2={plotY1}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
            />
          )}
        </>
      )}

      {drawables
        .filter(
          (d): d is Extract<typeof d, { kind: "band" }> => d.kind === "band",
        )
        .map((d) => (
          <path
            key={d.id}
            d={d.d}
            fill={d.color}
            fillOpacity={d.opacity}
            stroke="none"
          />
        ))}

      {/* A hard bound gets an edge; a one-sigma region has none, since it claims no boundary. */}
      {drawables
        .filter(
          (d): d is Extract<typeof d, { kind: "stroked" }> =>
            d.kind === "stroked",
        )
        .flatMap((d) =>
          d.uncertainty.map((region, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: a region has no identity beyond its run's position
              key={`${d.id}-band-${i}`}
              d={region.d}
              data-band-kind={region.kind}
              fill={d.color}
              fillOpacity={RECKONED_BAND_OPACITY}
              stroke={region.kind === "bound" ? d.color : "none"}
              strokeOpacity={
                region.kind === "bound" ? RECKONED_BAND_EDGE_OPACITY : undefined
              }
              strokeWidth={region.kind === "bound" ? 1 : undefined}
            />
          )),
        )}

      {drawables
        .filter(
          (d): d is Extract<typeof d, { kind: "stroked" }> =>
            d.kind === "stroked",
        )
        .flatMap((d) =>
          d.segments.map((seg, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a run has no identity beyond its position in the series
            <React.Fragment key={`${d.id}-${i}`}>
              {compact &&
                seg.basis === undefined &&
                areaUnder(seg.d, plotY1) && (
                  <path
                    d={areaUnder(seg.d, plotY1) ?? undefined}
                    fill={d.color}
                    fillOpacity={0.12}
                    stroke="none"
                  />
                )}
              <path
                d={seg.d}
                data-stream-status={seg.status}
                data-reckoning-basis={seg.basis}
                stroke={d.color}
                strokeWidth={1.5}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeOpacity={
                  seg.basis !== undefined ? RECKONED_STROKE_OPACITY : undefined
                }
                strokeDasharray={
                  seg.basis !== undefined
                    ? RECKONED_DASHARRAY
                    : d.dashed
                      ? "4 3"
                      : undefined
                }
              />
            </React.Fragment>
          )),
        )}

      {drawables
        .filter(
          (d): d is Extract<typeof d, { kind: "stroked" }> =>
            d.kind === "stroked",
        )
        .flatMap((d) =>
          d.modelled.map((path, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: a bridged gap has no identity beyond its position in the series
              key={`${d.id}-modelled-${i}`}
              d={path.d}
              data-reckoning-basis={path.basis}
              stroke={d.color}
              strokeWidth={1.5}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeOpacity={RECKONED_STROKE_OPACITY}
              strokeDasharray={RECKONED_DASHARRAY}
            />
          )),
        )}

      {drawables.map((d) =>
        d.kind === "stroked" && d.tail !== null ? (
          <ReckoningMarkSvg
            key={`${d.id}-tail`}
            kind="modelled"
            x={d.tail.cx}
            y={d.tail.cy}
          />
        ) : null,
      )}

      {/* The measured instants on a modelled span. */}
      {drawables
        .filter(
          (d): d is Extract<typeof d, { kind: "stroked" }> =>
            d.kind === "stroked",
        )
        .flatMap((d) =>
          d.observed.map((p, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: an observed sample has no identity beyond its position in the series
              key={`${d.id}-observed-${i}`}
              cx={p.cx}
              cy={p.cy}
              r={OBSERVED_MARK_RADIUS}
              fill={d.color}
              data-observed-sample=""
            />
          )),
        )}

      {drawables
        .filter(
          (d): d is Extract<typeof d, { kind: "scatter" }> =>
            d.kind === "scatter",
        )
        .flatMap((d) =>
          d.points.map((p, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: scatter points have no other identity
              key={`${d.id}-${i}`}
              cx={p.cx}
              cy={p.cy}
              r={SCATTER_RADIUS}
              fill={d.color}
            />
          )),
        )}

      {series.map((s) => {
        if (!s.headMark) return null;
        const scaleY = s.axis === "primary" ? scaleYPrimary : scaleYSecondary;
        let last = s.data.x.length - 1;
        while (
          last >= 0 &&
          !(Number.isFinite(s.data.x[last]) && Number.isFinite(s.data.y[last]))
        ) {
          last -= 1;
        }
        if (last < 0) return null;
        return (
          <circle
            key={`${s.id}-head`}
            cx={scaleX(s.data.x[last])}
            cy={scaleY(s.data.y[last])}
            r={HEAD_MARK_RADIUS}
            fill={s.headMark === "dot" ? s.color : "var(--color-surface-panel)"}
            stroke={s.color}
            strokeWidth={s.headMark === "dot" ? 0 : 1.5}
            data-head-mark={s.headMark}
          />
        );
      })}

      {layers && layers.length > 0 && (
        <g clipPath={`url(#${layerClipId})`}>
          <PlotLayers layers={layers} frame={layerFrame} pass="foreground" />
        </g>
      )}

      {thresholdLines.map((t) => (
        <React.Fragment key={t.id}>
          <line
            x1={plotX0}
            y1={t.y}
            x2={compact && t.kind === "marker" ? plotX0 + 24 : plotX1}
            y2={t.y}
            stroke={t.tone.line}
            strokeWidth={1}
            strokeDasharray={t.dashed ? "4 3" : undefined}
            data-threshold-kind={t.kind}
            data-threshold-passed={t.passed || undefined}
          />
          {/* The card carries every limit and target as a row, so its column does not write the same reading twice. */}
          {compact && t.kind === "marker" && t.label && (
            <text
              x={plotX0 + 28}
              y={t.y + 3.5}
              fill={t.tone.label}
              fontSize={10}
            >
              {t.label}
            </text>
          )}
          {!(compact && t.kind === "marker") &&
            t.label &&
            labelPlaces.get(t.id) && (
              <text
                x={labelPlaces.get(t.id)?.x}
                y={labelPlaces.get(t.id)?.y}
                textAnchor={labelPlaces.get(t.id)?.anchor}
                fill={t.tone.label}
                fontSize={10}
              >
                {t.label}
                {t.currency.held && (
                  <InstrumentHeldMark
                    size={10}
                    kind={t.currency.mark ?? "held"}
                  />
                )}
              </text>
            )}
        </React.Fragment>
      ))}

      {crossingMarks.map((mark) => (
        <LimitCrossingMark
          key={mark.key}
          x={mark.x}
          y={mark.y}
          size={LIMIT_MARK_SIZE}
          color={mark.color}
          text={mark.text}
        />
      ))}

      {legend !== "none" &&
        series.map((s, i) => {
          const at = legendBelow ? legendStrip.positions[i] : undefined;
          const rowY = at
            ? h - legendStripH + 2 + at.row * LEGEND_ROW_PX
            : plotY0 + 6 + i * LEGEND_ROW_PX;
          if (!legendBelow && rowY + 13 > plotY1) return null;
          const chipX = at
            ? LEGEND_STRIP_EDGE_PX + at.x
            : column
              ? column.x0
              : plotX0 + 3;
          const chipRoom = legendBelow
            ? w - 2 * LEGEND_STRIP_EDGE_PX
            : column
              ? column.x1 - column.x0
              : plotW - 6;
          // The SVG has no viewBox, so these pixel constants are CSS px and stay off the type scale.
          const chipW = chipWidth(s.label, chipRoom);
          // The root keeps overflow visible, so a clamped chip needs its label ellipsised.
          const maxChars = Math.max(1, Math.floor((chipW - 8) / 6));
          const labelText =
            s.label.length > maxChars
              ? `${s.label.slice(0, Math.max(1, maxChars - 1))}...`
              : s.label;
          return (
            <React.Fragment key={s.id}>
              <rect
                x={chipX}
                y={rowY}
                width={chipW}
                height={13}
                rx={2}
                fill="rgba(0, 0, 0, 0.55)"
              />
              <text x={chipX + 3} y={rowY + 10} fill={s.color} fontSize={10}>
                {labelText}
              </text>
            </React.Fragment>
          );
        })}

      {/* Readouts go last and outside the clip. */}
      {layers && layers.length > 0 && captionsFit && (
        <PlotLayers layers={layers} frame={layerFrame} pass="caption" />
      )}

      {crosshairReading !== null && cursorAt !== null && (
        <PlotCrosshair
          x={scaleX(cursorAt)}
          plot={{ x0: plotX0, y0: plotY0, x1: plotX1, y1: plotY1 }}
          heading={crosshairReading.heading}
          rows={crosshairReading.rows}
          avoid={legendBoxes}
          traces={cardTraces}
        />
      )}
    </svg>
  );

  const cardNode = hasCard ? (
    <div
      ref={setCardEl}
      data-plot-card=""
      style={{
        position: "absolute",
        left: cardBox?.x0 ?? 0,
        top: cardBox?.y0 ?? 0,
        visibility: cardBox && !cardYields ? "visible" : "hidden",
        pointerEvents: "none",
        width: "max-content",
        padding: "var(--gap-line) var(--gap-related)",
        background: "var(--color-surface-panel)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: 3,
      }}
    >
      {typeof card === "function"
        ? card({
            width: plotW - CARD_EDGE_PX * 2,
            height: plotH - CARD_EDGE_PX * 2,
            form: cardForm,
          })
        : card}
    </div>
  ) : null;

  if (!crosshairOn) {
    return (
      <>
        {chart}
        {cardNode}
      </>
    );
  }
  return (
    <>
      {chart}
      {cardNode}
      <VisuallyHidden id={`${uid}-crosshair-hint`}>
        Use the arrow keys to read the values at each sample
      </VisuallyHidden>
      {/* Set when a key moves the line and read once, so a streaming value never floods it. */}
      <VisuallyHidden role="status" aria-live="polite">
        {announcement}
      </VisuallyHidden>
    </>
  );
}

/** A log axis drops non-positive values so a stray zero cannot peg the floor at minus infinity. */
function computeYDomain(
  axisSeries: ChartSeries[],
  pinned: [number, number] | undefined,
  scale: AxisScale,
  layerYs: readonly number[] = [],
): [number, number] {
  if (pinned) return pinned;
  if (axisSeries.length === 0 && layerYs.length === 0)
    return scale === "log" ? [1, 10] : [0, 1];
  let all: number[] = [...axisSeries.flatMap(seriesYValues), ...layerYs];
  if (scale === "log") all = all.filter((v) => v > 0);
  if (all.length === 0) return scale === "log" ? [1, 10] : [0, 1];
  return [Math.min(...all), Math.max(...all)];
}

function formatYTick(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  // Scientific notation, or a log axis below 0.01 would print several ticks as "0.00".
  if (Math.abs(n) < 0.01) {
    const exp = Math.floor(Math.log10(Math.abs(n)));
    const mantissa = n / 10 ** exp;
    return Math.abs(mantissa - 1) < 1e-9
      ? `1e${exp}`
      : `${mantissa.toFixed(1)}e${exp}`;
  }
  return n.toFixed(2);
}
