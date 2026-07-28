/**
 * Dial: a full or near-full radial gauge with a needle, distinct from the
 * half-circle `Gauge` in @ksp-gonogo/ui. A round instrument whose needle sweeps
 * a configurable arc (default a full 360° compass), so it can show a heading
 * that wraps (slope-fall direction, drift bearing) as well as a bounded value a
 * half-dial can't wrap. Purely presentational: map data in via props.
 *
 * Angles are degrees clockwise from 12 o'clock (up = 0°), matching a compass.
 * `startAngle` places `min`; `sweep` is the span from `min` to `max`.
 *
 * 📌 Revisit (landing-widget plan A2): confirm after first real use whether Dial
 * belongs in ui-kit or demotes into the widget.
 *
 * Semantics: `role="meter"` on a styled wrapper (aria-valuenow / valuetext); the
 * SVG face is `aria-hidden`.
 */

import styled from "styled-components";

export interface DialZone {
  /** Lower bound of the coloured arc segment, in value units. */
  from: number;
  /** Upper bound of the coloured arc segment, in value units. */
  to: number;
  /** Arc colour. */
  color: string;
}

export interface DialTick {
  /** Value at which to draw the tick. */
  value: number;
  /** Optional short label (e.g. "N", "E"). */
  label?: string;
}

export interface DialProps {
  /** Current value: the needle position. */
  value: number;
  min: number;
  max: number;
  width?: number;
  height?: number;
  /** Degrees clockwise from up where `min` sits. Default 0 (top). */
  startAngle?: number;
  /** Degrees swept from `min` to `max`. Default 360 (full compass). */
  sweep?: number;
  /** Treat the value as wrapping (compass): value is taken modulo the range. */
  wrap?: boolean;
  zones?: ReadonlyArray<DialZone>;
  ticks?: ReadonlyArray<DialTick>;
  /** Unit suffix for the centre readout (e.g. "°"). */
  unit?: string;
  /** Centre label override. Defaults to the formatted value + unit. */
  valueLabel?: string;
  /** Label formatter. Defaults to a rounded number plus the unit. */
  format?: (v: number) => string;
  needleColor?: string;
  trackColor?: string;
  ariaLabel?: string;
}

const TRACK_THICKNESS = 6;
const HUB_RADIUS = 3;

function defaultFormat(v: number, unit?: string): string {
  const n = Number.isInteger(v) ? v : Number(v.toFixed(1));
  return unit ? `${n}${unit}` : `${n}`;
}

/** Point on a circle of radius `r`, `angleDeg` clockwise from up (12 o'clock). */
function pointAt(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): string {
  const p0 = pointAt(cx, cy, r, a0);
  const p1 = pointAt(cx, cy, r, a1);
  const delta = a1 - a0;
  const largeArc = Math.abs(delta) > 180 ? 1 : 0;
  const sweepFlag = delta >= 0 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

export function Dial({
  value,
  min,
  max,
  width = 120,
  height = 120,
  startAngle = 0,
  sweep = 360,
  wrap = false,
  zones,
  ticks,
  unit,
  valueLabel,
  format,
  needleColor = "var(--color-text-primary)",
  trackColor = "var(--color-border-subtle)",
  ariaLabel,
}: Readonly<DialProps>) {
  const span = max - min;
  const safe = Number.isFinite(value) ? value : min;
  const display =
    span > 0
      ? wrap
        ? min + ((((safe - min) % span) + span) % span)
        : Math.max(min, Math.min(max, safe))
      : min;
  const fmt = (v: number) => (format ? format(v) : defaultFormat(v, unit));

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - TRACK_THICKNESS - 2;

  const angleOf = (v: number): number => {
    const t = span > 0 ? (v - min) / span : 0;
    return startAngle + t * sweep;
  };

  const isFullCircle = sweep >= 360;
  const needle = pointAt(cx, cy, r * 0.88, angleOf(display));

  return (
    <Dial__Meter
      role="meter"
      aria-label={ariaLabel ?? "Dial"}
      aria-valuenow={display}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={fmt(display)}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        style={{
          display: "block",
          fontFamily: "monospace",
          maxWidth: "100%",
          height: "auto",
        }}
      >
        {/* Track */}
        {r > 0 &&
          (isFullCircle ? (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={trackColor}
              strokeWidth={TRACK_THICKNESS}
            />
          ) : (
            <path
              d={arcPath(cx, cy, r, startAngle, startAngle + sweep)}
              fill="none"
              stroke={trackColor}
              strokeWidth={TRACK_THICKNESS}
              strokeLinecap="round"
            />
          ))}

        {/* Zones */}
        {r > 0 &&
          zones?.map((z) => {
            const lo = Math.max(min, Math.min(z.from, z.to));
            const hi = Math.min(max, Math.max(z.from, z.to));
            if (!(hi > lo)) return null;
            return (
              <path
                key={`zone-${lo}-${hi}-${z.color}`}
                d={arcPath(cx, cy, r, angleOf(lo), angleOf(hi))}
                fill="none"
                stroke={z.color}
                strokeWidth={TRACK_THICKNESS}
                strokeLinecap="butt"
              />
            );
          })}

        {/* Ticks */}
        {r > 0 &&
          ticks?.map((tk) => {
            const a = angleOf(tk.value);
            const outer = pointAt(cx, cy, r, a);
            const inner = pointAt(cx, cy, r - TRACK_THICKNESS, a);
            const labelPt = pointAt(cx, cy, r - TRACK_THICKNESS - 8, a);
            return (
              <g key={`tick-${tk.value}-${tk.label ?? ""}`}>
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="var(--color-text-faint)"
                  strokeWidth={1}
                />
                {tk.label && (
                  <text
                    x={labelPt.x}
                    y={labelPt.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={9}
                    fill="var(--color-text-faint)"
                  >
                    {tk.label}
                  </text>
                )}
              </g>
            );
          })}

        {/* Needle + hub */}
        {r > 0 && (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={needle.x}
              y2={needle.y}
              stroke={needleColor}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r={HUB_RADIUS} fill={needleColor} />
          </>
        )}

        {/* Centre value */}
        <text
          x={cx}
          y={cy + r * 0.55}
          textAnchor="middle"
          fontSize={13}
          fontWeight="bold"
          fill="var(--color-text-primary)"
        >
          {valueLabel ?? fmt(display)}
        </text>
      </svg>
    </Dial__Meter>
  );
}

const Dial__Meter = styled.div`
  display: block;
  max-width: 100%;
`;
