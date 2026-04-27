import React, { useMemo } from "react";
import {
  buildPath,
  formatTimeLabel,
  makeScale,
  niceTicks,
} from "./lineChartMath";

/**
 * Columnar pairs of numeric values to plot. `x` and `y` are parallel arrays
 * of equal length. For time-on-x charts, `x` is unix ms; for parametric
 * charts (e.g. altitude vs velocity), `x` carries that dimension's values.
 */
export interface ChartSeriesData {
  x: number[];
  y: number[];
}

/**
 * Render type for a single series. Only `"line"` is implemented today; the
 * field is required on input so adding bar / step / scatter later needs no
 * schema migration, just a new branch in the renderer.
 */
export type SeriesType = "line";

export interface ChartSeries {
  id: string;
  label: string;
  axis: "primary" | "secondary";
  color: string;
  /** Defaults to `"line"` when omitted. */
  type?: SeriesType;
  data: ChartSeriesData;
}

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
  width: number;
  height: number;
}

const MARGIN = { top: 10, right: 50, bottom: 28, left: 50 };
const TICK_COUNT = 5;

export function LineChart({
  series,
  xDomain,
  yDomainPrimary,
  yDomainSecondary,
  xTickFormat = timeXTickFormat,
  yTickFormat = formatYTick,
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

  const primaryDomain = useMemo((): [number, number] => {
    if (yDomainPrimary) return yDomainPrimary;
    if (primarySeries.length === 0) return [0, 1];
    const all = primarySeries.flatMap((s) => s.data.y);
    return [Math.min(...all), Math.max(...all)];
  }, [primarySeries, yDomainPrimary]);

  const secondaryDomain = useMemo((): [number, number] => {
    if (yDomainSecondary) return yDomainSecondary;
    if (secondarySeries.length === 0) return [0, 1];
    const all = secondarySeries.flatMap((s) => s.data.y);
    return [Math.min(...all), Math.max(...all)];
  }, [secondarySeries, yDomainSecondary]);

  const scaleX = makeScale(xDomain[0], xDomain[1], plotX0, plotX1);
  const scaleYPrimary = makeScale(
    primaryDomain[0],
    primaryDomain[1],
    plotY1,
    plotY0,
  );
  const scaleYSecondary = makeScale(
    secondaryDomain[0],
    secondaryDomain[1],
    plotY1,
    plotY0,
  );

  const xTicks = niceTicks(xDomain[0], xDomain[1], TICK_COUNT);
  const yTicksPrimary = niceTicks(
    primaryDomain[0],
    primaryDomain[1],
    TICK_COUNT,
  );
  const yTicksSecondary = hasSecondary
    ? niceTicks(secondaryDomain[0], secondaryDomain[1], TICK_COUNT)
    : [];

  // Dispatch per series.type. Today only "line" is implemented; future types
  // (bar, step, scatter) add their own parallel collectors + render blocks.
  const paths = useMemo(() => {
    return series
      .filter((s) => s.data.x.length > 0 && (s.type ?? "line") === "line")
      .map((s) => {
        const scaleY = s.axis === "primary" ? scaleYPrimary : scaleYSecondary;
        return {
          id: s.id,
          color: s.color,
          d: buildPath(s.data.x, s.data.y, scaleX, scaleY),
        };
      });
  }, [series, scaleX, scaleYPrimary, scaleYSecondary]);

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
      style={{ fontFamily: "monospace", overflow: "visible" }}
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

      {/* Series paths */}
      {paths.map(({ id, color, d }) => (
        <path
          key={id}
          d={d}
          stroke={color}
          strokeWidth={1.5}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {/* Series labels (top-left legend) */}
      {series.map((s, i) => (
        <text
          key={s.id}
          x={plotX0 + 6}
          y={plotY0 + 14 + i * 16}
          fill={s.color}
          fontSize={10}
        >
          {s.label}
        </text>
      ))}
    </svg>
  );
}

function formatYTick(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
