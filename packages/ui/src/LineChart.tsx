import React, { useMemo } from "react";
import {
  buildBandPath,
  buildPath,
  buildStepPath,
  formatTimeLabel,
  makeLogScale,
  makeScale,
  niceLogTicks,
  niceTicks,
} from "./lineChartMath";

/**
 * Columnar pairs of numeric values to plot. `x` and `y` are parallel arrays
 * of equal length. For time-on-x charts, `x` is unix ms; for parametric
 * charts (e.g. altitude vs velocity), `x` carries that dimension's values.
 *
 * `y2` is only consulted for `type: "band"` series — it carries the upper
 * bound paired against `y` (the lower bound). Other series types ignore it.
 */
export interface ChartSeriesData {
  x: number[];
  y: number[];
  y2?: number[];
}

/**
 * Render type for a single series.
 * - `line`    — straight segments through every sample (default).
 * - `step`    — step-after; flat hold then jump. Right shape for discrete-state
 *               telemetry (stage number, throttle setting) where linear
 *               interpolation between transitions is misleading.
 * - `scatter` — discrete points, no joining. For sparse / noisy data.
 * - `band`    — filled envelope between `y` (lower) and `y2` (upper). Requires
 *               `data.y2` to be present and the same length as `data.y`.
 */
export type SeriesType = "line" | "step" | "scatter" | "band";

export interface ChartSeries {
  id: string;
  label: string;
  axis: "primary" | "secondary";
  color: string;
  /** Defaults to `"line"` when omitted. */
  type?: SeriesType;
  /** Render as a dashed line. Used to set reference / target curves apart from live traces. */
  dashed?: boolean;
  /** Fill opacity (0..1) for `band` series. Defaults 0.2. */
  fillOpacity?: number;
  data: ChartSeriesData;
}

/**
 * Horizontal reference line at a constant Y. Renders across the plot width
 * with an optional right-anchored label. Useful for "atmosphere ceiling",
 * "max-Q", "throttle limit", etc.
 */
export interface ThresholdRule {
  id: string;
  value: number;
  axis: "primary" | "secondary";
  label?: string;
  color?: string;
  dashed?: boolean;
}

export type AxisScale = "linear" | "log";

/** Default tick formatter for an x-axis representing wall-clock time (unix ms). */
export const timeXTickFormat = (
  value: number,
  domain: readonly [number, number],
): string => formatTimeLabel(value - domain[0], domain[1] - domain[0]);

export interface LineChartProps {
  series: ChartSeries[];
  /** x-domain. Interpretation depends on `xTickFormat` — defaults to unix ms. */
  xDomain: [number, number];
  yDomainPrimary?: [number, number];
  yDomainSecondary?: [number, number];
  /** Tick label formatter for the x-axis. Defaults to elapsed mm:ss / HH:mm:ss. */
  xTickFormat?: (value: number, domain: readonly [number, number]) => string;
  /** Tick label formatter for both y-axes. Defaults to k/M-suffixed numeric. */
  yTickFormat?: (value: number) => string;
  /** Linear (default) or log10 scale on each Y axis. */
  yScalePrimary?: AxisScale;
  yScaleSecondary?: AxisScale;
  /** Horizontal reference lines drawn across the plot. */
  thresholds?: ReadonlyArray<ThresholdRule>;
  /**
   * Series-label legend. `"overlay"` (default) stamps labels top-left inside
   * the plot, each on a translucent backing chip so they stay legible over
   * curves and gridlines; `"none"` suppresses it for charts whose title or
   * threshold label already names the series.
   */
  legend?: "overlay" | "none";
  width: number;
  height: number;
}

const MARGIN = { top: 10, right: 50, bottom: 28, left: 50 };
// Approximate pixels per tick label — used to scale tick count with plot
// dimensions so narrow charts don't stamp 5 labels into 100 px of x-axis
// (collides) and short charts don't stamp 5 labels into 80 px of y-axis.
const PX_PER_X_TICK = 70;
const PX_PER_Y_TICK = 35;
const SCATTER_RADIUS = 2;
const DEFAULT_BAND_OPACITY = 0.2;

/** Pull every plottable Y value out of a series, including band upper bounds. */
function seriesYValues(s: ChartSeries): number[] {
  if ((s.type ?? "line") === "band" && s.data.y2) {
    return [...s.data.y, ...s.data.y2];
  }
  return s.data.y;
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
  width,
  height,
}: Readonly<LineChartProps>) {
  const w = width;
  const h = height;
  const plotX0 = MARGIN.left;
  const plotX1 = w - MARGIN.right;
  const plotY0 = MARGIN.top;
  const plotY1 = h - MARGIN.bottom;
  const plotW = plotX1 - plotX0;
  const plotH = plotY1 - plotY0;

  const primarySeries = series.filter(
    (s) => s.axis === "primary" && s.data.x.length > 0,
  );
  const secondarySeries = series.filter(
    (s) => s.axis === "secondary" && s.data.x.length > 0,
  );
  const hasSecondary = secondarySeries.length > 0;

  const primaryDomain = useMemo(
    (): [number, number] =>
      computeYDomain(primarySeries, yDomainPrimary, yScalePrimary),
    [primarySeries, yDomainPrimary, yScalePrimary],
  );

  const secondaryDomain = useMemo(
    (): [number, number] =>
      computeYDomain(secondarySeries, yDomainSecondary, yScaleSecondary),
    [secondarySeries, yDomainSecondary, yScaleSecondary],
  );

  const scaleX = makeScale(xDomain[0], xDomain[1], plotX0, plotX1);
  const scaleYPrimary =
    yScalePrimary === "log"
      ? makeLogScale(primaryDomain[0], primaryDomain[1], plotY1, plotY0)
      : makeScale(primaryDomain[0], primaryDomain[1], plotY1, plotY0);
  const scaleYSecondary =
    yScaleSecondary === "log"
      ? makeLogScale(secondaryDomain[0], secondaryDomain[1], plotY1, plotY0)
      : makeScale(secondaryDomain[0], secondaryDomain[1], plotY1, plotY0);

  const xTickCount = Math.max(
    2,
    Math.min(8, Math.round(plotW / PX_PER_X_TICK)),
  );
  const yTickCount = Math.max(
    2,
    Math.min(7, Math.round(plotH / PX_PER_Y_TICK)),
  );
  const xTicks = niceTicks(xDomain[0], xDomain[1], xTickCount);
  const yTicksPrimary =
    yScalePrimary === "log"
      ? niceLogTicks(primaryDomain[0], primaryDomain[1], yTickCount)
      : niceTicks(primaryDomain[0], primaryDomain[1], yTickCount);
  const yTicksSecondary = !hasSecondary
    ? []
    : yScaleSecondary === "log"
      ? niceLogTicks(secondaryDomain[0], secondaryDomain[1], yTickCount)
      : niceTicks(secondaryDomain[0], secondaryDomain[1], yTickCount);

  // Per-series renderable. Dispatch on type — line/step/scatter share the
  // stroked-path render block; band gets a filled closed path.
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
        return {
          id: s.id,
          kind: "stroked" as const,
          color: s.color,
          dashed: s.dashed ?? false,
          d: builder(s.data.x, s.data.y, scaleX, scaleY),
        };
      });
  }, [series, scaleX, scaleYPrimary, scaleYSecondary]);

  const thresholdLines = useMemo(() => {
    if (!thresholds) return [];
    return thresholds.map((t) => ({
      id: t.id,
      label: t.label,
      color: t.color ?? "var(--color-text-faint)",
      dashed: t.dashed ?? true,
      y:
        t.axis === "primary"
          ? scaleYPrimary(t.value)
          : scaleYSecondary(t.value),
    }));
  }, [thresholds, scaleYPrimary, scaleYSecondary]);

  // Container is narrower/shorter than the margins — nothing meaningful to
  // draw, and negative <rect> dimensions spam the console. Render an empty
  // svg until the ResizeObserver reports a usable size.
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

  return (
    <svg
      width={w}
      height={h}
      role="img"
      aria-label="Telemetry line chart"
      // `display: block` removes the inline-baseline whitespace that an SVG
      // otherwise carries below itself. With a flex `min-height:0` ancestor
      // (ChartArea) the baseline gap pushes contentRect a few px past the
      // height we just set, ResizeObserver fires, we set a larger height,
      // and the chart slowly grows turn after turn — visible most clearly
      // on graphs the user keeps open through a long flight.
      style={{ fontFamily: "monospace", overflow: "visible", display: "block" }}
    >
      <title>Telemetry line chart</title>
      {/* Background */}
      <rect
        x={plotX0}
        y={plotY0}
        width={plotW}
        height={plotH}
        fill="var(--color-surface-panel)"
      />

      {/* Horizontal grid lines + left y-axis ticks. Keyed by index rather
          than value because niceTicks returns duplicate ticks when the domain
          has zero span (single-sample or pinned-equal-bounds data). */}
      {yTicksPrimary.map((tick, idx) => {
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
            <text
              x={plotX0 - 4}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--color-text-faint)"
              fontSize={11}
            >
              {yTickFormat(tick)}
            </text>
          </React.Fragment>
        );
      })}

      {/* Right y-axis ticks (secondary) */}
      {yTicksSecondary.map((tick, idx) => {
        const y = scaleYSecondary(tick);
        return (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: tick position IS identity; niceTicks may emit duplicate values for zero-span domains
            key={`sy-${idx}`}
            x={plotX1 + 4}
            y={y}
            textAnchor="start"
            dominantBaseline="middle"
            fill="var(--color-text-faint)"
            fontSize={11}
          >
            {yTickFormat(tick)}
          </text>
        );
      })}

      {/* Vertical grid lines + x-axis ticks */}
      {xTicks.map((tick, idx) => {
        const x = scaleX(tick);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: tick position IS identity; niceTicks may emit duplicate values for zero-span domains
          <React.Fragment key={`xt-${idx}`}>
            <line
              x1={x}
              y1={plotY0}
              x2={x}
              y2={plotY1}
              stroke="var(--color-border-subtle)"
              strokeWidth={1}
            />
            <text
              x={x}
              y={plotY1 + 14}
              textAnchor="middle"
              fill="var(--color-text-faint)"
              fontSize={11}
            >
              {xTickFormat(tick, xDomain)}
            </text>
          </React.Fragment>
        );
      })}

      {/* Axis borders */}
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

      {/* Bands first (filled, behind everything else). */}
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

      {/* Stroked series (line + step). */}
      {drawables
        .filter(
          (d): d is Extract<typeof d, { kind: "stroked" }> =>
            d.kind === "stroked",
        )
        .map((d) => (
          <path
            key={d.id}
            d={d.d}
            stroke={d.color}
            strokeWidth={1.5}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={d.dashed ? "4 3" : undefined}
          />
        ))}

      {/* Scatter dots. */}
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

      {/* Threshold rules (horizontal reference lines). */}
      {thresholdLines.map((t) => (
        <React.Fragment key={t.id}>
          <line
            x1={plotX0}
            y1={t.y}
            x2={plotX1}
            y2={t.y}
            stroke={t.color}
            strokeWidth={1}
            strokeDasharray={t.dashed ? "4 3" : undefined}
          />
          {t.label && (
            <text
              x={plotX1 - 4}
              y={t.y - 3}
              textAnchor="end"
              fill={t.color}
              fontSize={10}
            >
              {t.label}
            </text>
          )}
        </React.Fragment>
      ))}

      {/* Series labels (top-left legend), each on a translucent backing chip
          so the text stays legible over curves/gridlines. Labels that would
          fall into the x-axis tick band are dropped rather than overlapping. */}
      {legend !== "none" &&
        series.map((s, i) => {
          const rowY = plotY0 + 6 + i * 16;
          // Don't stamp a label where it would collide with the x-axis ticks.
          if (rowY + 13 > plotY1) return null;
          // Approximate text width (≈6 px per glyph at fontSize 10); clamp so
          // the chip never runs past the plot's right edge on narrow charts.
          const chipW = Math.min(s.label.length * 6 + 8, plotW - 6);
          return (
            <React.Fragment key={s.id}>
              <rect
                x={plotX0 + 3}
                y={rowY}
                width={chipW}
                height={13}
                rx={2}
                fill="rgba(0, 0, 0, 0.55)"
              />
              <text x={plotX0 + 6} y={rowY + 10} fill={s.color} fontSize={10}>
                {s.label}
              </text>
            </React.Fragment>
          );
        })}
    </svg>
  );
}

/**
 * Compute the auto-scale Y domain for an axis. Honours an explicit pin when
 * provided; otherwise scans every series (including band upper bounds). On a
 * log axis, non-positive values are filtered out before computing the range
 * so a stray zero doesn't peg the floor at -∞.
 */
function computeYDomain(
  axisSeries: ChartSeries[],
  pinned: [number, number] | undefined,
  scale: AxisScale,
): [number, number] {
  if (pinned) return pinned;
  if (axisSeries.length === 0) return scale === "log" ? [1, 10] : [0, 1];
  let all: number[] = axisSeries.flatMap(seriesYValues);
  if (scale === "log") all = all.filter((v) => v > 0);
  if (all.length === 0) return scale === "log" ? [1, 10] : [0, 1];
  return [Math.min(...all), Math.max(...all)];
}

function formatYTick(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  // Sub-precision values would round to "0.00" via toFixed(2). Log axes
  // can pull ticks well below 0.01 (atmospheric profile drops into the
  // µPa range past 60 km), so fall back to scientific notation so each
  // tick gets a distinct label instead of three copies of "0.00".
  if (Math.abs(n) < 0.01) {
    const exp = Math.floor(Math.log10(Math.abs(n)));
    const mantissa = n / 10 ** exp;
    return Math.abs(mantissa - 1) < 1e-9
      ? `1e${exp}`
      : `${mantissa.toFixed(1)}e${exp}`;
  }
  return n.toFixed(2);
}
