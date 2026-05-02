import { useMemo } from "react";

/**
 * Half-circle gauge / dial — value displayed as a needle within a
 * `min..max` arc. Zones colour the arc to highlight ranges (e.g. red below
 * 1 and green above 1.5 for TWR). Compact (2:1 aspect) and readable at a
 * glance.
 *
 * The component is purely presentational: it draws the arc, the zones, the
 * needle, and the optional centre value/label. Wire it up to live data
 * via `useDataValue` in the consumer.
 */
export interface GaugeZone {
  /** Lower bound of the zone (inclusive). */
  from: number;
  /** Upper bound of the zone (exclusive at the top end, except for the last zone). */
  to: number;
  /** CSS colour for this zone. */
  color: string;
}

export interface GaugeProps {
  value: number;
  min: number;
  max: number;
  width: number;
  height: number;
  /** Optional zones drawn as coloured arc segments. Order doesn't matter. */
  zones?: ReadonlyArray<GaugeZone>;
  /** Centre numeric label. Defaults to `value.toFixed(2)`. */
  valueLabel?: string;
  /** Small label below the value (e.g. unit). */
  unitLabel?: string;
  /** Needle colour. Defaults to `var(--color-text-primary)`. */
  needleColor?: string;
  /** Arc track colour (the unfilled portion). Defaults to faint border. */
  trackColor?: string;
  /** ARIA label. Defaults to `Gauge: <value>`. */
  ariaLabel?: string;
}

const TRACK_THICKNESS = 8;
const NEEDLE_HUB_RADIUS = 4;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Map a value in [min, max] to a point on the upper semicircle of `radius`. */
function pointOnArc(
  value: number,
  min: number,
  max: number,
  radius: number,
): { x: number; y: number; angleRad: number } {
  const t = clamp((value - min) / (max - min), 0, 1);
  // π at left (value=min) → 0 at right (value=max), sweeping over the top.
  const angleRad = Math.PI * (1 - t);
  return {
    x: radius * Math.cos(angleRad),
    y: -radius * Math.sin(angleRad),
    angleRad,
  };
}

function arcSegmentPath(
  fromValue: number,
  toValue: number,
  min: number,
  max: number,
  radius: number,
): string {
  const start = pointOnArc(fromValue, min, max, radius);
  const end = pointOnArc(toValue, min, max, radius);
  // Arcs are always ≤ 180° on this gauge → large-arc = 0. The arc is drawn
  // counter-clockwise in SVG coordinates (sweep = 0) since `pointOnArc`
  // emits y < 0 for the top half and the path goes left → right via the top.
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export function Gauge({
  value,
  min,
  max,
  width,
  height,
  zones,
  valueLabel,
  unitLabel,
  needleColor = "var(--color-text-primary)",
  trackColor = "var(--color-border-subtle)",
  ariaLabel,
}: Readonly<GaugeProps>) {
  const safeValue = Number.isFinite(value) ? value : min;

  // Pad the bounding box so the half-circle isn't clipped at the edges.
  // Arc lives in the upper half; reserve a strip below for the value label.
  const radius = Math.min(
    (width - TRACK_THICKNESS) / 2,
    height - TRACK_THICKNESS - 18,
  );

  const needle = useMemo(
    () => pointOnArc(safeValue, min, max, radius * 0.92),
    [safeValue, min, max, radius],
  );

  if (radius <= 0) {
    return (
      <svg
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        role="img"
        aria-label={ariaLabel ?? `Gauge: ${safeValue}`}
      >
        <title>{ariaLabel ?? "Gauge"}</title>
      </svg>
    );
  }

  // Translate so (0, 0) is the centre-bottom of the arc.
  const cx = width / 2;
  const cy = radius + TRACK_THICKNESS / 2;

  const trackPath = arcSegmentPath(min, max, min, max, radius);

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel ?? `Gauge: ${safeValue}`}
      style={{ display: "block", fontFamily: "monospace" }}
    >
      <title>{ariaLabel ?? `Gauge: ${safeValue}`}</title>
      <g transform={`translate(${cx} ${cy})`}>
        {/* Track (uncoloured background arc) */}
        <path
          d={trackPath}
          stroke={trackColor}
          strokeWidth={TRACK_THICKNESS}
          fill="none"
          strokeLinecap="round"
        />
        {/* Zones */}
        {zones?.map((z, i) => {
          const from = clamp(z.from, min, max);
          const to = clamp(z.to, min, max);
          if (to <= from) return null;
          return (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: zones have no other identity
              key={`zone-${i}`}
              d={arcSegmentPath(from, to, min, max, radius)}
              stroke={z.color}
              strokeWidth={TRACK_THICKNESS}
              fill="none"
              strokeLinecap="butt"
            />
          );
        })}
        {/* Needle */}
        <line
          x1={0}
          y1={0}
          x2={needle.x}
          y2={needle.y}
          stroke={needleColor}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx={0} cy={0} r={NEEDLE_HUB_RADIUS} fill={needleColor} />
      </g>
      {/* Centre value */}
      <text
        x={cx}
        y={cy + 18}
        textAnchor="middle"
        fontSize={16}
        fill="var(--color-text-primary)"
      >
        {valueLabel ?? safeValue.toFixed(2)}
      </text>
      {unitLabel && (
        <text
          x={cx}
          y={cy + 32}
          textAnchor="middle"
          fontSize={10}
          fill="var(--color-text-faint)"
        >
          {unitLabel}
        </text>
      )}
    </svg>
  );
}
