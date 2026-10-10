import type {
  PlotLayer,
  SeriesBridge,
  SeriesStatusSpan,
} from "@ksp-gonogo/sitrep-sdk";
import {
  InstrumentHeldMark,
  PlotCrosshair,
  type PlotCrosshairRow,
  placePlotReadouts,
  plotCrosshairShowsCard,
  ReckoningMarkSvg,
  reckoningBasisPhrase,
  resolveCurrency,
  sayHeld,
  type UnitValue,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import React, { useId, useMemo, useState } from "react";
import { sampleNearest, sampleTimes, stepTime } from "./crosshairMath";
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
 * Parallel `x` and `y` arrays to plot; `x` is unix ms on a time chart. `y2` is the upper bound of a
 * `band` series.
 *
 * `breaks` names indices that open a real hole: `line` and `step` start a fresh subpath there.
 * `spans` records runs that did not arrive live, and they are drawn exactly like live data, because a
 * replayed sample is still a measured one. `reckoned` runs, which a model carried forward, are muted
 * and dashed, and may carry a shaded uncertainty band behind the stroke.
 */
export interface ChartSeriesData {
  x: number[];
  y: number[];
  y2?: number[];
  breaks?: number[];
  spans?: readonly SeriesStatusSpan[];
  reckoned?: readonly SeriesReckonedSpan[];
  /** A model's path through an unobserved gap; drawn instead of the chord when the chord departs from it by more than a pixel. */
  bridges?: readonly SeriesBridge[];
}

/** Larger than a scatter dot so it holds its own against the dashed line crossing it. */
const OBSERVED_MARK_RADIUS = 2.5;

/**
 * Render type for a single series
 * - `line`: straight segments through every sample (default)
 * - `step`: step-after, for discrete-state telemetry where interpolating between transitions misleads
 * - `scatter`: discrete points, no joining
 * - `band`: filled envelope between `y` (lower) and `y2` (upper), which must be the same length
 */
export type SeriesType = "line" | "step" | "scatter" | "band";

export interface ChartSeries {
  id: string;
  label: string;
  axis: "primary" | "secondary";
  color: string;
  /** Defaults to `"line"` when omitted. */
  type?: SeriesType;
  /** Render as a dashed line, for reference or target curves. */
  dashed?: boolean;
  /** Fill opacity (0..1) for `band` series. Defaults 0.2. */
  fillOpacity?: number;
  /** Writes one of this series' figures with its unit, for the crosshair readout. Falls back to the axis tick formatter. */
  format?: (y: number) => string;
  data: ChartSeriesData;
}

/**
 * What a threshold line is for, which decides how it is drawn.
 *
 * - `limit`: a figure not to pass, with the side that is past it declared. Dashed and quiet until a trace on its axis stands at or past it, then in the warning tone, and each place a trace went past it carries a warning mark
 * - `target`: a figure to reach. Dashed and quiet until a trace on its axis has reached it, then in the go tone
 * - `marker`: where something is now. Solid, and never changes tone
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
  /** What the line was drawn from. A held one marks the label, and one a model carried is marked as modelled; the chart's accessible name says which. */
  reading?: UnitValue;
}

/** Horizontal reference line at a constant Y, with an optional right-anchored label. Its tone comes from `kind` and the plotted data, never from the caller. */
export type ThresholdRule = ThresholdRuleBase &
  (
    | { kind: "limit"; bad: LimitSide }
    | { kind: Exclude<ThresholdKind, "limit"> }
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

export type AxisScale = "linear" | "log";

/** Default tick formatter for an x-axis representing wall-clock time (unix ms). */
export const timeXTickFormat = (
  value: number,
  domain: readonly [number, number],
): string => formatTimeLabel(value - domain[0], domain[1] - domain[0]);

/** Tick formatter for an x-axis in UT seconds; pick it by the basis the producer declared, never by the size of the numbers. */
export const utXTickFormat = (
  value: number,
  domain: readonly [number, number],
): string =>
  formatTimeLabel((value - domain[0]) * 1000, (domain[1] - domain[0]) * 1000);

export interface LineChartProps {
  series: ChartSeries[];
  /** x-domain. Interpretation depends on `xTickFormat`: defaults to unix ms. */
  xDomain: [number, number];
  yDomainPrimary?: [number, number];
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
  yScaleSecondary?: AxisScale;
  /** Horizontal reference lines drawn across the plot. */
  thresholds?: ReadonlyArray<ThresholdRule>;
  /** `"overlay"` (default) stamps labels top-left on backing chips; `"none"` suppresses them. */
  legend?: "overlay" | "none";
  /** Drop the X tick ladder and its gridlines, for a one-dimensional plot; layers are still placed against the domain. */
  hideXAxis?: boolean;
  /** A view of a place rather than a chart: no tick ladders, content to the frame edges, and equal scale on both axes. */
  spatial?: boolean;
  /** Scales the pitch of a spatial plot's dot lattice from its usual gap, clamped to 0.5 to 2, so the lattice can carry the zoom. */
  gridScale?: number;
  /** Everything drawn beyond the series, in data space. Layers join an auto Y domain and are ignored by a pinned one. */
  layers?: readonly PlotLayer[];
  /** Names what the chart is, before the layers add their own clauses. */
  "aria-label"?: string;
  /**
   * A crosshair that reads every series at one instant: on pointer hover, and
   * from the keyboard (the chart takes focus; arrow keys step through the
   * samples, shift for ten at a time, Home and End for the ends, Escape to
   * clear). Only meaningful when x is time, so that samples are ordered along
   * it. Off by default.
   */
  crosshair?: boolean;
  width: number;
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

/** The width the column beside the plot needs to hold its widest line whole: the legend chips, the captions and the card's rows. */
function readoutColumnWidth({
  series,
  thresholds,
  heading,
  crosshairOn,
  yTickFormat,
}: {
  series: readonly ChartSeries[];
  thresholds: readonly ThresholdRule[];
  heading: readonly string[];
  crosshairOn: boolean;
  yTickFormat: (v: number) => string;
}): number {
  const px = (chars: number) => chars * LABEL_CHAR_PX;
  const widths: number[] = [];
  for (const s of series) {
    widths.push(px(s.label.length) + 8);
    if (crosshairOn) {
      widths.push(
        Math.max(
          px(s.label.length),
          px(CARD_FIGURE_CHARS + CARD_CURRENCY_CHARS),
        ) + CARD_PAD_PX,
      );
    }
  }
  for (const t of thresholds) {
    if (t.kind === "marker") continue;
    const figure = t.label ?? yTickFormat(t.value);
    widths.push(px(figure.length) + LABEL_MARK_PX + 8);
    if (crosshairOn) {
      widths.push(Math.max(px(t.kind.length), px(figure.length)) + CARD_PAD_PX);
    }
  }
  if (crosshairOn) {
    widths.push(Math.max(...heading.map((h) => px(h.length))) + CARD_PAD_PX);
  }
  return Math.max(0, ...widths) + COLUMN_SLACK_PX;
}

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
  legend = "overlay",
  hideXAxis = false,
  spatial = false,
  gridScale = 1,
  layers,
  "aria-label": ariaLabel,
  crosshair = false,
  width,
  height,
}: Readonly<LineChartProps>) {
  const uid = useId();
  // With nothing plotted there is nothing to read, so the chart takes no tab stop.
  const crosshairOn =
    crosshair && !spatial && series.some((s) => s.data.x.length > 0);
  const [cursor, setCursor] = useState<{
    at: number;
    source: "pointer" | "keys";
  } | null>(null);
  const [focusRing, setFocusRing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const w = width;
  const h = height;

  const primarySeries = series.filter(
    (s) => s.axis === "primary" && s.data.x.length > 0,
  );
  const secondarySeries = series.filter(
    (s) => s.axis === "secondary" && s.data.x.length > 0,
  );
  const hasSecondary = secondarySeries.length > 0;

  // One pixel of inset keeps the outermost stroke from being clipped by the frame.
  const fitted = spatial
    ? { top: 1, right: 1, bottom: 1, left: 1 }
    : fitMargins(w, h, hasSecondary);
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
  const margin = spatial
    ? fitted
    : {
        ...fitted,
        left: labelGutter(yTicksPrimary, fitted.left),
        right: hasSecondary
          ? labelGutter(yTicksSecondary, fitted.right)
          : fitted.right,
      };
  const plotX0 = margin.left;
  // The card, legend and captions share one placement: a column beside the plot when the chart has room, the plot itself otherwise.
  // A chart with nothing to read out keeps the whole width for its plot.
  const hasReadouts =
    crosshairOn ||
    (legend !== "none" && series.length > 0) ||
    (thresholds ?? []).some((t) => t.label);
  const readouts =
    spatial || !hasReadouts
      ? ({ placement: "overlay" } as const)
      : placePlotReadouts({
          width: w,
          height: h,
          contentWidth: readoutColumnWidth({
            series,
            thresholds: thresholds ?? [],
            heading: [xDomain[0], xDomain[1]].map((v) =>
              xTickFormat(v, xDomain),
            ),
            crosshairOn,
            yTickFormat,
          }),
        });
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
        ...crossingMarks.map((m) => ({
          x0: m.x - half,
          y0: m.y - half,
          x1: m.x + half,
          y1: m.y + half,
        })),
        ...(legend === "none"
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
    column,
    thresholdLines,
    crossingMarks,
    legend,
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
    const name = t.label ?? t.id;
    const clauses: string[] = [];
    if (t.passed && t.kind === "limit") clauses.push(`${name}: limit passed`);
    if (t.passed && t.kind === "target")
      clauses.push(`${name}: target reached`);
    if (t.currency.held) clauses.push(sayHeld(name, t.currency.caption));
    // A label with no room to be drawn is still said.
    if (t.label && !labelPlaces.get(t.id) && clauses.length === 0)
      clauses.push(t.label);
    return clauses;
  });

  const chartLabel = [
    ariaLabel ?? "Telemetry line chart",
    ...plotLayerDescriptions(layers ?? []),
    ...reckonedClauses,
    ...thresholdClauses,
  ].join("; ");

  const crosshairSeries = useMemo(
    () => series.filter((s) => s.data.x.length > 0),
    [series],
  );
  const crosshairTimes = useMemo(
    () => (crosshairOn ? sampleTimes(crosshairSeries) : []),
    [crosshairOn, crosshairSeries],
  );
  const xLo = Math.min(xDomain[0], xDomain[1]);
  const xHi = Math.max(xDomain[0], xDomain[1]);

  /** Every series' figure at `at`, and the limits, with the words that name the instant. */
  function readAt(at: number): { heading: string; rows: PlotCrosshairRow[] } {
    const rows: PlotCrosshairRow[] = crosshairSeries.map((s) => {
      const sample = sampleNearest(s, at);
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
        currency: sample.currency,
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
    return { heading: xTickFormat(at, xDomain), rows };
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
  // The card names every series in its colour, so the legend gives its corner up while the card is drawn.
  const cardShown =
    crosshairReading !== null &&
    plotCrosshairShowsCard({
      x: cursorAt === null ? 0 : scaleX(cursorAt),
      plot: { x0: plotX0, y0: plotY0, x1: plotX1, y1: plotY1 },
      heading: crosshairReading.heading,
      rows: crosshairReading.rows,
      column,
      traces: tracePixels,
    });

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
      <title>{chartLabel}</title>
      {layers && layers.length > 0 && (
        <defs>
          <clipPath id={layerClipId}>
            <rect x={plotX0} y={plotY0} width={plotW} height={plotH} />
          </clipPath>
        </defs>
      )}
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
      {!spatial &&
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

      {!spatial &&
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
        !spatial &&
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
        !spatial &&
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

      {!spatial && (
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
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: a run has no identity beyond its position in the series
              key={`${d.id}-${i}`}
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
            x2={plotX1}
            y2={t.y}
            stroke={t.tone.line}
            strokeWidth={1}
            strokeDasharray={t.dashed ? "4 3" : undefined}
            data-threshold-kind={t.kind}
            data-threshold-passed={t.passed || undefined}
          />
          {/* The card carries every limit and target as a row, so its column does not write the same reading twice. */}
          {t.label &&
            labelPlaces.get(t.id) &&
            !(column !== undefined && cardShown && t.kind !== "marker") && (
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
        !cardShown &&
        series.map((s, i) => {
          const rowY = plotY0 + 6 + i * 16;
          if (rowY + 13 > plotY1) return null;
          const chipX = column ? column.x0 : plotX0 + 3;
          const chipRoom = column ? column.x1 - column.x0 : plotW - 6;
          // The SVG has no viewBox, so these pixel constants are CSS px and stay off the type scale.
          const chipW = Math.min(s.label.length * 6 + 8, chipRoom);
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
          column={column}
          traces={tracePixels}
        />
      )}
    </svg>
  );

  if (!crosshairOn) return chart;
  return (
    <>
      {chart}
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
