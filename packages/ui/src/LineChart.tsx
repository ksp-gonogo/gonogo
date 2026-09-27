import type {
  BandKind,
  PlotLayer,
  ReckoningBasis,
  SeriesBridge,
  SeriesStatusSpan,
} from "@ksp-gonogo/sitrep-sdk";
import {
  bandClaim,
  InstrumentHeldMark,
  resolveCurrency,
  sayHeld,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import React, { useId, useMemo } from "react";
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
} from "./plotLayers";

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
  data: ChartSeriesData;
}

/** Horizontal reference line at a constant Y, with an optional right-anchored label. */
export interface ThresholdRule {
  id: string;
  value: number;
  axis: "primary" | "secondary";
  label?: string;
  color?: string;
  dashed?: boolean;
  /** When held, the label carries the held-reading mark and the chart's accessible name says so. */
  reading?: UnitValue;
  /** The line stands at the reading's modelled figure rather than its observation, so a figure carried to SCET is marked too. */
  drawsReckoning?: boolean;
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
  /** Tick label formatter for the x-axis. Defaults to elapsed mm:ss / HH:mm:ss. */
  xTickFormat?: (value: number, domain: readonly [number, number]) => string;
  /** Tick label formatter for both y-axes. Defaults to k/M-suffixed numeric. */
  yTickFormat?: (value: number) => string;
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
  /** Everything drawn beyond the series, in data space. Layers join an auto Y domain and are ignored by a pinned one. */
  layers?: readonly PlotLayer[];
  /** Names what the chart is, before the layers add their own clauses. */
  ariaLabel?: string;
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
const SPATIAL_GRID_PITCH_PX = 26;

/** Inset half a pitch so no dot sits on the frame's own edge. */
function spatialGrid(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Array<{ key: string; x: number; y: number }> {
  const dots: Array<{ key: string; x: number; y: number }> = [];
  const p = SPATIAL_GRID_PITCH_PX;
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
const DEFAULT_BAND_OPACITY = 0.2;
/** A reckoned run is muted and dashed, never recoloured; 0.6 keeps series colours above 3:1 against the surface. */
const RECKONED_STROKE_OPACITY = 0.6;
const RECKONED_DASHARRAY = "5 3";
/** An uncertainty region takes its own series' colour so a two-series chart still says whose it is. */
const RECKONED_BAND_OPACITY = 0.15;
const RECKONED_BAND_EDGE_OPACITY = 0.45;

const RECKONING_BASIS_PHRASE: Record<ReckoningBasis, string> = {
  // A combination joins readings of one moment; it never advances a value through time.
  combination: "computed from several readings of the same moment",
  "kepler-propagation": "propagated forward on two-body motion",
  "linear-dead-reckoning": "carried forward at the last observed velocity",
  "rate-integration": "integrated forward at the last observed rate",
};

function bandKindPhrase(kind: BandKind): string {
  return bandClaim(kind, "the value is inside the shaded region");
}

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
  hideXAxis = false,
  spatial = false,
  layers,
  ariaLabel,
  width,
  height,
}: Readonly<LineChartProps>) {
  const uid = useId();
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
  const margin = spatial
    ? { top: 1, right: 1, bottom: 1, left: 1 }
    : fitMargins(w, h, hasSecondary);
  const plotX0 = margin.left;
  const plotX1 = w - margin.right;
  const plotY0 = margin.top;
  const plotY1 = h - margin.bottom;
  const plotW = plotX1 - plotX0;
  const plotH = plotY1 - plotY0;
  const captionsFit =
    plotW >= CAPTION_MIN_PLOT_W && plotH >= CAPTION_MIN_PLOT_H;

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
  const xTicks = axisTicks(xDomain[0], xDomain[1], xTickCount, "linear");
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

  // Labels are thinned so none overlap or clip; the endpoints are edge-anchored.
  const xTickLabels = useMemo(() => {
    const out: {
      x: number;
      text: string;
      anchor: "start" | "middle" | "end";
    }[] = [];
    const last = xTicks.length - 1;
    if (last < 0) return out;
    const estPx = (s: string) => s.length * 6.5 + 6;
    const gap = 6;
    const make = (idx: number) => {
      const tick = xTicks[idx];
      const text = xTickFormat(tick, xDomain);
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
    return thresholds.map((t) => ({
      id: t.id,
      label: t.label,
      currency: resolveCurrency(t.reading, {
        drawsReckoning: t.drawsReckoning,
      }),
      color: t.color ?? "var(--color-text-faint)",
      dashed: t.dashed ?? true,
      y:
        t.axis === "primary"
          ? scaleYPrimary(t.value)
          : scaleYSecondary(t.value),
    }));
  }, [thresholds, scaleYPrimary, scaleYSecondary]);

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
        `${s.label}: part of this trace is reckoned, ${RECKONING_BASIS_PHRASE[basis]}, not measured`,
    );
    const kinds = new Set(
      runs
        .map((run) => (run.bandLo && run.bandHi ? run.bandKind : undefined))
        .filter((kind): kind is BandKind => kind !== undefined),
    );
    for (const kind of kinds) {
      clauses.push(`${s.label}: ${bandKindPhrase(kind)}`);
    }
    return clauses;
  });

  const thresholdClauses = thresholdLines
    .filter((t) => t.currency.notCurrent)
    .map((t) => sayHeld(t.label ?? t.id, t.currency.caption));

  const chartLabel = [
    ariaLabel ?? "Telemetry line chart",
    ...plotLayerDescriptions(layers ?? []),
    ...reckonedClauses,
    ...thresholdClauses,
  ].join("; ");

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

  return (
    <svg
      width={w}
      height={h}
      role="img"
      aria-label={chartLabel}
      // display: block stops the inline baseline gap feeding the ResizeObserver a growing height.
      style={{
        fontFamily: "var(--font-family-mono)",
        overflow: "visible",
        display: "block",
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
                  {yTickFormat(tick)}
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
              {yTickFormat(tick)}
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
        spatialGrid(plotX0, plotX1, plotY0, plotY1).map((dot) => (
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
              {t.currency.notCurrent && <InstrumentHeldMark size={10} />}
            </text>
          )}
        </React.Fragment>
      ))}

      {legend !== "none" &&
        series.map((s, i) => {
          const rowY = plotY0 + 6 + i * 16;
          if (rowY + 13 > plotY1) return null;
          // The SVG has no viewBox, so these pixel constants are CSS px and stay off the type scale.
          const chipW = Math.min(s.label.length * 6 + 8, plotW - 6);
          // The root keeps overflow visible, so a clamped chip needs its label ellipsised.
          const maxChars = Math.max(1, Math.floor((chipW - 8) / 6));
          const labelText =
            s.label.length > maxChars
              ? `${s.label.slice(0, Math.max(1, maxChars - 1))}...`
              : s.label;
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
                {labelText}
              </text>
            </React.Fragment>
          );
        })}

      {/* Readouts go last and outside the clip. */}
      {layers && layers.length > 0 && captionsFit && (
        <PlotLayers layers={layers} frame={layerFrame} pass="caption" />
      )}
    </svg>
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
