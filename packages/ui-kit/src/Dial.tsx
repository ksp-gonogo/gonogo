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
 *
 * The whole axis is ONE kind: `value`, `min`, `max`, every zone bound and every
 * tick are `Value<U>` of the same unit, so a tick that belongs to another scale
 * is a compile error rather than a mark in the wrong place. The centre readout
 * writes that unit itself; there is no unit string to pass, because a symbol
 * passed beside a bare number is a symbol nothing checks.
 */

import type { Value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { type FormatsFor, speakQuantity, writeQuantity } from "./units";

export interface DialZone<U extends string = string> {
  /** Lower bound of the coloured arc segment. */
  from: Value<U>;
  /** Upper bound of the coloured arc segment. */
  to: Value<U>;
  /** Arc colour. */
  color: string;
}

export interface DialTick<U extends string = string> {
  /** Value at which to draw the tick. */
  value: Value<U>;
  /** Optional short label (e.g. "N", "E"). */
  label?: string;
}

export interface DialProps<U extends string = string> {
  /** Current value: the needle position. */
  value: Value<U>;
  min: Value<U>;
  max: Value<U>;
  width?: number;
  height?: number;
  /** Degrees clockwise from up where `min` sits. Default 0 (top). */
  startAngle?: number;
  /** Degrees swept from `min` to `max`. Default 360 (full compass). */
  sweep?: number;
  /** Treat the value as wrapping (compass): value is taken modulo the range. */
  wrap?: boolean;
  zones?: ReadonlyArray<DialZone<U>>;
  ticks?: ReadonlyArray<DialTick<U>>;
  /**
   * Pin the rung the centre readout is written at, for the cases where
   * convention beats magnitude. Absent, the value's own kind decides.
   */
  format?: FormatsFor<U>;
  /** Centre label override. Defaults to the value, written with its unit. */
  valueLabel?: string;
  needleColor?: string;
  trackColor?: string;
  ariaLabel?: string;
}

const TRACK_THICKNESS = 6;
const HUB_RADIUS = 3;

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

export function Dial<U extends string = string>({
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
  valueLabel,
  format,
  needleColor = "var(--color-text-primary)",
  trackColor = "var(--color-border-subtle)",
  ariaLabel,
}: Readonly<DialProps<U>>) {
  /*
   * The axis, unwrapped ONCE into the face's own angular geometry. Everything
   * below is trigonometry on bare numbers, which is what an arc command is
   * made of; one `U` across value, min, max, zones and ticks is what makes
   * these magnitudes comparable in the first place. Every figure a READER sees
   * goes back out through the unit layer, in the centre readout and in
   * `aria-valuetext`.
   */
  const current = value.magnitude;
  const axisMin = min.magnitude;
  const axisMax = max.magnitude;
  const span = axisMax - axisMin;
  const safe = Number.isFinite(current) ? current : axisMin;
  const display =
    span > 0
      ? wrap
        ? axisMin + ((((safe - axisMin) % span) + span) % span)
        : Math.max(axisMin, Math.min(axisMax, safe))
      : axisMin;
  /*
   * An SVG `<text>` cannot contain a `<span>`, so `<Unit>` will not go in one
   * and `writeQuantity` is the sanctioned way out: same formatter, same attach
   * rule (a dial's degree sign is written hard against its number), rendered
   * to a string. `speakQuantity` is its spoken twin, for `aria-valuetext`,
   * which is an attribute and can only hold text.
   */
  const shown = { magnitude: display, unit: value.unit };
  const centreLabel = valueLabel ?? writeQuantity(shown, { format });
  const spoken = speakQuantity(shown, { format });

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - TRACK_THICKNESS - 2;

  const angleOf = (v: number): number => {
    const t = span > 0 ? (v - axisMin) / span : 0;
    return startAngle + t * sweep;
  };

  const isFullCircle = sweep >= 360;
  const needle = pointAt(cx, cy, r * 0.88, angleOf(display));

  return (
    <Dial__Meter
      role="meter"
      aria-label={ariaLabel ?? "Dial"}
      aria-valuenow={display}
      aria-valuemin={axisMin}
      aria-valuemax={axisMax}
      aria-valuetext={spoken}
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
            const from = z.from.magnitude;
            const to = z.to.magnitude;
            const lo = Math.max(axisMin, Math.min(from, to));
            const hi = Math.min(axisMax, Math.max(from, to));
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
            const at = tk.value.magnitude;
            const a = angleOf(at);
            const outer = pointAt(cx, cy, r, a);
            const inner = pointAt(cx, cy, r - TRACK_THICKNESS, a);
            const labelPt = pointAt(cx, cy, r - TRACK_THICKNESS - 8, a);
            return (
              <g key={`tick-${at}-${tk.label ?? ""}`}>
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
          {centreLabel}
        </text>
      </svg>
    </Dial__Meter>
  );
}

const Dial__Meter = styled.div`
  display: block;
  max-width: 100%;
`;
