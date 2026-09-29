import { useId, useMemo } from "react";
import { buildPath, makeScale } from "./lineChartMath";

/** Inline trendline with no axes or labels; `values` run oldest to newest and a flat series still draws a visible band. */
export interface SparklineProps {
  values: ReadonlyArray<number>;
  width: number;
  height: number;
  /** Stroke colour. Defaults to `var(--color-text-primary)`. */
  color?: string;
  /** Stroke width in pixels. Defaults to 1.5. */
  strokeWidth?: number;
  /** Pin the Y range; otherwise auto-scaled. Useful for "0..max-throttle" gauges. */
  yDomain?: [number, number];
  /** Render a faint baseline at y=0 if 0 falls within the visible range. */
  showZeroBaseline?: boolean;
  /** The faint fill under the line; set false inside a chip that has its own background. */
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
  // A stray NaN would collapse the auto-domain.
  const finite = useMemo(
    () => values.filter((v) => Number.isFinite(v)) as number[],
    [values],
  );

  // useId's colons are not valid inside an SVG url(#id) reference.
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
      const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.01 : 1;
      return [min - pad, max + pad];
    }
    return [min, max];
  }, [yDomain, finite]);

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

  // Half a stroke width of padding keeps the extreme points from being clipped by the SVG box.
  const padY = strokeWidth / 2;
  const xs = finite.map((_, i) => i);
  const scaleX = makeScale(0, finite.length - 1, 0, width);
  const scaleY = makeScale(domain[0], domain[1], height - padY, padY);
  const d = buildPath(xs, finite, scaleX, scaleY);
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
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
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
