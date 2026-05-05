import { useId, useMemo } from "react";
import { buildPath, makeScale } from "./lineChartMath";

/**
 * Tiny inline trendline. No axes, no margins, no labels — just the path.
 * Designed to embed next to a numeric readout (e.g. TWR, SMA, altitude) so
 * the reader can glance at the recent trend without taking up much space.
 *
 * The component is purely presentational: it accepts an array of `values`
 * (oldest → newest) and renders them at the given `width`/`height`. Y axis
 * auto-scales to the data range with a small padding factor so a flat line
 * still draws something visible.
 */
export interface SparklineProps {
  values: ReadonlyArray<number>;
  width: number;
  height: number;
  /** Stroke colour. Defaults to `var(--color-text-primary)`. */
  color?: string;
  /** Stroke width in pixels. Defaults to 1.5 — thin enough to feel inline,
   *  thick enough not to read as a misdraw on standard-DPI screens. */
  strokeWidth?: number;
  /** Pin the Y range; otherwise auto-scaled. Useful for "0..max-throttle" gauges. */
  yDomain?: [number, number];
  /** Render a faint baseline at y=0 if 0 falls within the visible range. */
  showZeroBaseline?: boolean;
  /**
   * Render a faint plot background + soft fill under the line so the
   * sparkline reads as a chart rather than a single floating stroke.
   * Defaults to `true`; set false when embedding inside a chip that
   * already provides its own background.
   */
  background?: boolean;
  /** ARIA label for screen readers. Defaults to "Trend sparkline". */
  ariaLabel?: string;
}

export function Sparkline({
  values,
  width,
  height,
  color = "var(--color-text-primary)",
  strokeWidth = 1.5,
  yDomain,
  showZeroBaseline = false,
  background = true,
  ariaLabel = "Trend sparkline",
}: Readonly<SparklineProps>) {
  // Filter out non-finite values defensively — a stray NaN in the source
  // collapses the auto-domain and drags the path off-screen.
  const finite = useMemo(
    () => values.filter((v) => Number.isFinite(v)) as number[],
    [values],
  );

  // Stable instance-scoped ID for the gradient `<defs>`. React 18's useId
  // emits ":r0:"-style strings that aren't valid in SVG `url(#id)`
  // references; strip the colons. Has to be called unconditionally
  // (rules-of-hooks) — gradient consumption is gated by `background` later.
  const fillId = `sparkline-fill-${useId().replace(/:/g, "")}`;

  const domain = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    if (finite.length === 0) return [0, 1];
    let min = finite[0];
    let max = finite[0];
    for (const v of finite) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === max) {
      // Pad ±1% of value (or ±1 if value is zero) so a flat line still has
      // a visible band to draw within.
      const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.01 : 1;
      return [min - pad, max + pad];
    }
    return [min, max];
  }, [yDomain, finite]);

  // Render path even at very small sizes; if invalid, just emit an empty SVG.
  if (width <= 0 || height <= 0 || finite.length < 2) {
    return (
      <svg
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block" }}
      >
        <title>{ariaLabel}</title>
      </svg>
    );
  }

  const xs = finite.map((_, i) => i);
  const scaleX = makeScale(0, finite.length - 1, 0, width);
  const scaleY = makeScale(domain[0], domain[1], height, 0);
  const d = buildPath(xs, finite, scaleX, scaleY);
  // Filled-area path: the line plus the bottom-left/right corners. Gives
  // the sparkline visual weight against a plot background without
  // requiring a second data array.
  const dFill = `${d} L ${width},${height} L 0,${height} Z`;

  const showBaseline = showZeroBaseline && domain[0] <= 0 && domain[1] >= 0;
  const zeroY = showBaseline ? scaleY(0) : null;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      style={{ display: "block" }}
    >
      <title>{ariaLabel}</title>
      {background && (
        <>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="var(--color-surface-app)"
            opacity={0.6}
          />
        </>
      )}
      {showBaseline && zeroY !== null && (
        <line
          x1={0}
          y1={zeroY}
          x2={width}
          y2={zeroY}
          stroke="var(--color-border-subtle)"
          strokeWidth={1}
        />
      )}
      {background && <path d={dFill} fill={`url(#${fillId})`} stroke="none" />}
      <path
        d={d}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
