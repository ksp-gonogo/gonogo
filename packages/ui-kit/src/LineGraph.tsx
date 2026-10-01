import styled from "styled-components";

/**
 * One line on a {@link LineGraph}.
 *
 * @category LineGraph
 */
export interface LineGraphSeries {
  /** Unique within the graph; used as the line's React key. */
  id: string;
  /** Name of this line, for the caller's own bookkeeping. Not rendered; the chart's accessible name is the graph's `ariaLabel`. */
  label?: string;
  /** CSS colour for the stroke, e.g. `var(--color-nogo-mark)`. */
  color: string;
  /** Ascending by `x`. Fewer than two points renders no line for this series. */
  points: ReadonlyArray<{ x: number; y: number }>;
  /**
   * Indices into `points` that open a known hole: no data between the previous
   * point and that one (a comms blackout, a recording that overran). The stroke
   * and the sparkline fill break there, since a line through a span with no
   * readings would look like data.
   */
  breaks?: readonly number[];
}

/**
 * A horizontal reference level on a {@link LineGraph}, such as a safe limit.
 *
 * @category LineGraph
 */
export interface LineGraphThreshold {
  /** Unique within the graph; used as the threshold's React key. */
  id: string;
  /** Name of the level, for the caller's own bookkeeping. Not rendered; `valueText` is the drawn annotation. */
  label?: string;
  /** The y value the threshold is drawn at, in the same terms as the series' `y`. */
  value: number;
  /** Defaults to a muted warning colour, distinct from the data series. */
  color?: string;
  /**
   * Short text drawn beside a `"marker"`-style threshold (e.g. `"0.5"`),
   * naming the level the tick sits at. Without it the marker is a bare tick.
   * Ignored by the `"full"` rule, which is its own annotation.
   */
  valueText?: string;
}

/**
 * How a {@link LineGraph} draws its thresholds: `"full"` is a dashed rule
 * across the frame, `"marker"` a short tick at the left edge.
 *
 * @category LineGraph
 */
export type LineGraphThresholdStyle = "full" | "marker";

/**
 * Props for {@link LineGraph}.
 *
 * @category LineGraph
 */
export interface LineGraphProps {
  /** The lines to draw, all against one shared x and y domain. */
  series: readonly LineGraphSeries[];
  /** Horizontal reference levels. */
  thresholds?: readonly LineGraphThreshold[];
  /** Pins the Y domain; otherwise derived from every series' + threshold's values. */
  yDomain?: readonly [number, number];
  /** Chart height in pixels. Width always fills the parent. */
  height?: number;
  /**
   * Accessible name for the whole chart (`role="img"`). Omit when the trend is
   * decorative beside a readout that already carries the reading, and the chart
   * renders `aria-hidden`.
   */
  ariaLabel?: string;
  className?: string;
  /**
   * `"chart"` (default): quarter gridlines and bare strokes. `"sparkline"`: no
   * gridlines, and each series area-shaded down to the frame's bottom edge, for
   * a compact glance trend.
   */
  variant?: "chart" | "sparkline";
  /**
   * How a threshold draws at its y-height. `"full"` (default) is a dashed rule
   * spanning the frame. `"marker"` is a fixed ~24px tick at the left edge with
   * the threshold's `valueText` beside it, for a threshold that is context
   * rather than the subject of the chart.
   */
  thresholdStyle?: LineGraphThresholdStyle;
}

const VIEW_W = 100;
const VIEW_H = 40;

function computeDomain(
  series: readonly LineGraphSeries[],
  thresholds: readonly LineGraphThreshold[],
): [number, number] {
  const ys: number[] = [];
  for (const s of series)
    for (const p of s.points) if (Number.isFinite(p.y)) ys.push(p.y);
  for (const t of thresholds) if (Number.isFinite(t.value)) ys.push(t.value);
  if (ys.length === 0) return [0, 1];
  let min = ys[0];
  let max = ys[0];
  for (const y of ys) {
    if (y < min) min = y;
    if (y > max) max = y;
  }
  if (min === max) {
    // A flat/single-value read still needs headroom to draw a visible line rather than one hugging an edge.
    const pad = min === 0 ? 1 : Math.abs(min) * 0.5;
    return [min - pad, max + pad];
  }
  // 8% headroom top and bottom so a peak/trough never touches the frame.
  const span = max - min;
  return [min - span * 0.08, max + span * 0.08];
}

/**
 * One series' points cut into unbroken runs at its `breaks` indices.
 */
function splitAtBreaks(
  points: ReadonlyArray<{ x: number; y: number }>,
  breaks: readonly number[] | undefined,
): Array<ReadonlyArray<{ x: number; y: number }>> {
  // A sample that is not a finite number is a hole, the same as a stated break.
  const holes = points.flatMap((p, i) =>
    Number.isFinite(p.x) && Number.isFinite(p.y) ? [] : [i],
  );
  if (holes.length > 0) {
    const finite = points.filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    );
    const shifted = [...(breaks ?? []), ...holes]
      .map((cut) => cut - holes.filter((h) => h < cut).length)
      .filter((cut, i, all) => all.indexOf(cut) === i);
    return splitAtBreaks(finite, shifted);
  }
  if (!breaks || breaks.length === 0) return [points];
  const runs: Array<ReadonlyArray<{ x: number; y: number }>> = [];
  const cuts = [...new Set(breaks)]
    .filter((i) => i > 0 && i < points.length)
    .sort((a, b) => a - b);
  let start = 0;
  for (const cut of cuts) {
    runs.push(points.slice(start, cut));
    start = cut;
  }
  runs.push(points.slice(start));
  return runs;
}

function computeXDomain(series: readonly LineGraphSeries[]): [number, number] {
  const xs: number[] = [];
  for (const s of series)
    for (const p of s.points) if (Number.isFinite(p.x)) xs.push(p.x);
  if (xs.length === 0) return [0, 1];
  let min = xs[0];
  let max = xs[0];
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return min === max ? [min - 1, max + 1] : [min, max];
}

/**
 * A minimal multi-series time-trend chart: coloured lines against a shared
 * domain, plus optional reference lines. For readings that need a trend rather
 * than a precise value; pair it with a {@link Unit} readout for the value.
 *
 * No axis ticks, no legend, no interaction. Gridlines are fixed quarter-marks.
 * Width fills the parent and strokes keep a constant width however the chart
 * is stretched. The y domain is derived from every series and threshold, with
 * headroom, unless `yDomain` pins it.
 *
 * @example A compact dose-rate trend with a safe limit marked
 * ```tsx
 * <LineGraph
 *   variant="sparkline"
 *   height={96}
 *   ariaLabel="Radiation dose rate, last 10 minutes"
 *   series={[
 *     {
 *       id: "ambient",
 *       label: "Ambient",
 *       color: "var(--color-nogo-mark)",
 *       points: samples.map((s) => ({ x: s.ut, y: s.radPerHour })),
 *     },
 *   ]}
 *   thresholds={[{ id: "safe", label: "Safe threshold", value: 0.5 }]}
 *   thresholdStyle="marker"
 * />
 * ```
 *
 * @category LineGraph
 */
export function LineGraph({
  series,
  thresholds = [],
  yDomain,
  height = 120,
  ariaLabel,
  className,
  variant = "chart",
  thresholdStyle = "full",
}: LineGraphProps) {
  const [yMin, yMax] = yDomain ?? computeDomain(series, thresholds);
  const [xMin, xMax] = computeXDomain(series);
  const ySpan = yMax - yMin || 1;
  const xSpan = xMax - xMin || 1;
  const isSparkline = variant === "sparkline";

  const toX = (x: number) => ((x - xMin) / xSpan) * VIEW_W;
  const toY = (y: number) => VIEW_H - ((y - yMin) / ySpan) * VIEW_H;

  return (
    <LineGraph__Root className={className} style={{ height }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : "true"}
      >
        {!isSparkline &&
          [0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={VIEW_W}
              y1={VIEW_H * f}
              y2={VIEW_H * f}
              stroke="var(--color-border-subtle)"
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
            />
          ))}

        {isSparkline &&
          series.map((s) => {
            // Fewer than two points draws nothing, as for the stroke.
            if (s.points.length < 2) return null;
            // One polygon per unbroken run, so a hole leaves unshaded ground.
            return splitAtBreaks(s.points, s.breaks).map((run) => {
              if (run.length < 2) return null;
              const first = run[0];
              const last = run[run.length - 1];
              const areaPoints = [
                ...run.map((p) => `${toX(p.x)},${toY(p.y)}`),
                `${toX(last.x)},${VIEW_H}`,
                `${toX(first.x)},${VIEW_H}`,
              ].join(" ");
              return (
                <polygon
                  key={`${s.id}-area-${first.x}`}
                  points={areaPoints}
                  fill={s.color}
                  fillOpacity={0.12}
                  stroke="none"
                />
              );
            });
          })}

        {thresholdStyle === "full" &&
          thresholds.map((t) => (
            <line
              key={t.id}
              x1={0}
              x2={VIEW_W}
              y1={toY(t.value)}
              y2={toY(t.value)}
              stroke={t.color ?? "var(--color-warn-text)"}
              strokeWidth={0.6}
              strokeDasharray="2 1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}

        {series.map((s) => {
          if (s.points.length < 2) return null;
          /*
           * One polyline per unbroken run, keyed on its own first x, since run
           * boundaries move as data slides through the window.
           */
          return splitAtBreaks(s.points, s.breaks).map((run) => {
            if (run.length < 2) return null;
            const points = run.map((p) => `${toX(p.x)},${toY(p.y)}`).join(" ");
            return (
              <polyline
                key={`${s.id}-${run[0].x}`}
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth={isSparkline ? 1 : 1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          });
        })}
      </svg>

      {/* "marker" thresholds are an HTML overlay outside the stretched viewBox, so their size stays fixed on screen. */}
      {thresholdStyle === "marker" &&
        thresholds.map((t) => {
          const topPct = ((yMax - t.value) / ySpan) * 100;
          // A threshold outside the pinned domain is skipped rather than pinned to an edge it is not at.
          if (topPct < 0 || topPct > 100) return null;
          return (
            <LineGraph__ThresholdMarker
              key={t.id}
              aria-hidden="true"
              data-threshold-marker={t.id}
              style={{
                top: `${topPct}%`,
                color: t.color ?? "var(--color-warn-text)",
              }}
            >
              <LineGraph__ThresholdTick />
              {t.valueText !== undefined && <span>{t.valueText}</span>}
            </LineGraph__ThresholdMarker>
          );
        })}
    </LineGraph__Root>
  );
}

const LineGraph__ThresholdMarker = styled.div`
  position: absolute;
  left: 0;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: var(--gap-glyph);
  pointer-events: none;
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  /* Single-glyph chrome text centring against a 2px tick: the flush rung. */
  line-height: var(--line-height-flush);
`;

/** The fixed ~24px tick, the length `Card`'s identity tab uses for a mark rather than a rule. */
const LineGraph__ThresholdTick = styled.span`
  display: inline-block;
  width: var(--size-mark);
  height: 2px;
  border-radius: var(--radius-pill);
  background: currentColor;
`;

const LineGraph__Root = styled.div`
  position: relative;
  width: 100%;
  min-height: 0;

  svg {
    display: block;
  }
`;
