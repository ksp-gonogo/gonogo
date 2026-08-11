import styled from "styled-components";

export interface LineGraphSeries {
  id: string;
  /** Accessible name for this line; not rendered on screen (callers show the
   *  live value beside the graph via `Value`/`Unit`, this only labels the
   *  trace for the summary below). */
  label: string;
  /** CSS colour for the stroke, e.g. `var(--color-status-nogo-bg)`. */
  color: string;
  /** Ascending by `x`. Fewer than two points renders no line for this series. */
  points: ReadonlyArray<{ x: number; y: number }>;
}

export interface LineGraphThreshold {
  id: string;
  label: string;
  value: number;
  /** Defaults to a muted warning colour: a reference line reads as "the line
   *  to watch", distinct from either data series. */
  color?: string;
  /**
   * Short text drawn beside a `"marker"`-style threshold (e.g. `"0.5"`),
   * naming the level the tick sits at. Without it the marker is a bare tick.
   * Ignored by the `"full"` rule, which is its own annotation.
   */
  valueText?: string;
}

export type LineGraphThresholdStyle = "full" | "marker";

export interface LineGraphProps {
  series: readonly LineGraphSeries[];
  thresholds?: readonly LineGraphThreshold[];
  /** Pins the Y domain; otherwise derived from every series' + threshold's values. */
  yDomain?: readonly [number, number];
  /** Chart height in pixels. Width always fills the parent. */
  height?: number;
  /**
   * Accessible name for the whole chart (`role="img"`). Omit when the trend
   * is decorative alongside a live numeric readout that already carries the
   * reading (the usual case: pair this with `Value`/`Unit` text, not a
   * restated aria-label), in which case the chart renders `aria-hidden`.
   */
  ariaLabel?: string;
  className?: string;
  /**
   * `"chart"` (default): the original instrument look, quarter gridlines,
   * bare strokes. `"sparkline"`: drops the gridlines and area-shades under
   * each series down to the frame's bottom edge, reading as a compact glance
   * trend rather than a technical instrument. Threshold lines and series
   * strokes render identically in both, this only changes the frame
   * decoration and whether a fill sits under the lines.
   */
  variant?: "chart" | "sparkline";
  /**
   * How a threshold draws at its y-height. `"full"` (default) is the
   * original dashed rule spanning the whole frame, which reads as "this
   * chart is about staying under this line". `"marker"` draws a short FIXED
   * ~24px tick anchored at the frame's left edge instead, with the
   * threshold's `valueText` beside it: an axis annotation, not a rule. It
   * renders as an HTML overlay rather than inside the stretched viewBox, so
   * its length is genuinely fixed on screen at every width. Use it where
   * the threshold is context for a glance trend, not the subject of the
   * chart.
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
  for (const s of series) for (const p of s.points) ys.push(p.y);
  for (const t of thresholds) ys.push(t.value);
  if (ys.length === 0) return [0, 1];
  let min = ys[0];
  let max = ys[0];
  for (const y of ys) {
    if (y < min) min = y;
    if (y > max) max = y;
  }
  if (min === max) {
    // A flat/single-value read still needs headroom to draw a visible line
    // rather than one hugging an edge.
    const pad = min === 0 ? 1 : Math.abs(min) * 0.5;
    return [min - pad, max + pad];
  }
  // 8% headroom top and bottom so a peak/trough never touches the frame.
  const span = max - min;
  return [min - span * 0.08, max + span * 0.08];
}

function computeXDomain(series: readonly LineGraphSeries[]): [number, number] {
  const xs: number[] = [];
  for (const s of series) for (const p of s.points) xs.push(p.x);
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
 * A minimal multi-series time-trend chart: a set of coloured lines against a
 * shared domain, plus optional dashed horizontal reference lines. Built for
 * readings that need a TREND (is this climbing, is it staying under a line)
 * rather than a precise value, which is what the adjacent `Value`/`Unit`
 * readout is for.
 *
 * Deliberately spare: no axis ticks, no legend, no interaction. A widget
 * pairs this with its own labelled current-value readouts and belt/state
 * badges; this component only draws the shape of the trend. In `"chart"`
 * variant, grid lines are fixed quarter-marks (25/50/75%) rather than
 * data-derived ticks, since nothing here knows the quantity's kind well
 * enough to pick a sensible round-number tick; `"sparkline"` drops them
 * entirely and area-shades under each series instead, for a reading that
 * wants to look like a glance trend rather than an engineering instrument.
 *
 * SVG rather than a canvas/library dependency: matches the rest of the kit's
 * hand-drawn primitives (`Dial`, `Tape`, `DivergingBar`), keeps ui-kit's zero
 * runtime dependency, and a `viewBox`-scaled `<polyline>` needs no imperative
 * redraw on resize. `vector-effect="non-scaling-stroke"` keeps every stroke a
 * constant on-screen width regardless of how the `viewBox` gets stretched to
 * its container, rather than needing to divide by zoom by hand.
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
            // Same "fewer than two points draws nothing" rule as the stroke
            // below: an area under a single point is not a shape, it is a
            // triangle standing in for data that was never there.
            if (s.points.length < 2) return null;
            const first = s.points[0];
            const last = s.points[s.points.length - 1];
            const areaPoints = [
              ...s.points.map((p) => `${toX(p.x)},${toY(p.y)}`),
              `${toX(last.x)},${VIEW_H}`,
              `${toX(first.x)},${VIEW_H}`,
            ].join(" ");
            return (
              <polygon
                key={`${s.id}-area`}
                points={areaPoints}
                fill={s.color}
                // Subtler than a chart-style fill: operator feedback on the
                // second pass still read the sparkline as too instrument-like,
                // a lighter shade reads as a glance trend rather than a
                // filled-in area chart.
                fillOpacity={0.12}
                stroke="none"
              />
            );
          })}

        {thresholdStyle === "full" &&
          thresholds.map((t) => (
            <line
              key={t.id}
              x1={0}
              x2={VIEW_W}
              y1={toY(t.value)}
              y2={toY(t.value)}
              stroke={t.color ?? "var(--color-status-warning-fg-muted)"}
              strokeWidth={0.6}
              strokeDasharray="2 1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}

        {series.map((s) => {
          if (s.points.length < 2) return null;
          const points = s.points
            .map((p) => `${toX(p.x)},${toY(p.y)}`)
            .join(" ");
          return (
            <polyline
              key={s.id}
              points={points}
              fill="none"
              stroke={s.color}
              // Thinner in the sparkline variant: a glance trend reads as a
              // fine line, not the same weight an engineering `"chart"`
              // instrument uses.
              strokeWidth={isSparkline ? 1 : 1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {/* "marker" thresholds live OUTSIDE the stretched viewBox: an HTML
          overlay at the threshold's own height, so the tick's ~24px length
          and the label's type size stay genuinely fixed on screen instead of
          scaling with the frame. Decorative beside the labelled readouts, so
          it is hidden from the accessibility tree like the rest of the
          drawing. */}
      {thresholdStyle === "marker" &&
        thresholds.map((t) => {
          const topPct = ((yMax - t.value) / ySpan) * 100;
          // A threshold outside the pinned domain has no honest place to
          // draw; skip it rather than pinning it to an edge it isn't at.
          if (topPct < 0 || topPct > 100) return null;
          return (
            <LineGraph__ThresholdMarker
              key={t.id}
              aria-hidden="true"
              data-threshold-marker={t.id}
              style={{
                top: `${topPct}%`,
                color: t.color ?? "var(--color-status-warning-fg-muted)",
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
  gap: var(--space-4, 4px);
  pointer-events: none;
  font-size: var(--font-size-2xs, 10px);
  font-variant-numeric: tabular-nums;
  /* Single-glyph chrome text centring against a 2px tick: the flush rung. */
  line-height: var(--line-height-flush, 1);
`;

/** The fixed tick: ~24px, matching the length the identity tab on `Card`
 *  uses for the same "a mark, not a rule" reading. */
const LineGraph__ThresholdTick = styled.span`
  display: inline-block;
  width: var(--space-24, 24px);
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
