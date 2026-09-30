import { bandIn, type Value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import {
  heldNameMarker,
  InstrumentBound,
  InstrumentHeldMark,
  sayHeld,
} from "./instrumentCurrency";
import { NULL_DISPLAY } from "./NullValue";
import {
  figureAttributes,
  resolveCurrency,
  type UnitValue,
} from "./readingCurrency";
import { placedOnScale, standsApart } from "./standsApart";
import { type FormatsFor, speakQuantity, writeQuantity } from "./units";

/**
 * A coloured segment of a {@link Dial}'s arc, in the dial's own unit.
 *
 * @category Gauge
 */
export interface DialZone<Unit extends string = string> {
  /** Lower bound of the coloured arc segment. */
  from: Value<Unit>;
  /** Upper bound of the coloured arc segment. */
  to: Value<Unit>;
  /** Arc colour. */
  color: string;
}

/**
 * A tick mark on a {@link Dial}'s face, with an optional label beside it.
 *
 * @category Gauge
 */
export interface DialTick<Unit extends string = string> {
  /** Value at which to draw the tick. */
  value: Value<Unit>;
  /** Optional short label (e.g. "N", "E"). */
  label?: string;
}

/**
 * Props for {@link Dial}.
 *
 * @category Gauge
 */
export interface DialProps<Unit extends string = string> {
  /** Current value: the needle position, or the whole reading it arrived in. */
  value: UnitValue<Unit>;
  /** The value at `startAngle`. */
  min: Value<Unit>;
  /** The value at `startAngle + sweep`. */
  max: Value<Unit>;
  /**
   * Drawn width in pixels. The SVG scales down to a narrower slot rather than
   * clipping.
   *
   * @defaultValue `120`
   */
  width?: number;
  /**
   * Drawn height in pixels.
   *
   * @defaultValue `120`
   */
  height?: number;
  /** Degrees clockwise from up where `min` sits. Default 0 (top). */
  startAngle?: number;
  /** Degrees swept from `min` to `max`. Default 360 (full compass). */
  sweep?: number;
  /**
   * Treat the value as wrapping (compass): value is taken modulo the range.
   * Without it a value outside `min..max` pins the needle at the nearer end.
   */
  wrap?: boolean;
  /** Coloured arc segments. */
  zones?: ReadonlyArray<DialZone<Unit>>;
  /** Tick marks around the face. */
  ticks?: ReadonlyArray<DialTick<Unit>>;
  /**
   * Pin the rung the centre readout is written at, for the cases where
   * convention beats magnitude. Absent, the value's own kind decides.
   */
  format?: FormatsFor<Unit>;
  /** Centre label override. Defaults to the value, written with its unit. */
  valueLabel?: string;
  /** Needle colour. Defaults to `var(--color-text-primary)`. */
  needleColor?: string;
  /** Arc track colour. Defaults to `var(--color-border-subtle)`. */
  trackColor?: string;
  /** Accessible name. Defaults to `"Dial"`; the value is spoken as `aria-valuetext`. */
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

/**
 * A round instrument whose needle sweeps a configurable arc (by default a full
 * 360° compass), so it can show a heading that wraps as well as a bounded
 * value. The half-circle sibling is {@link Gauge}.
 *
 * Angles are degrees clockwise from 12 o'clock (up is 0°), as on a compass.
 * `startAngle` places `min`; `sweep` is the span from `min` to `max`.
 *
 * The whole axis is one kind: `value`, `min`, `max`, every zone bound and
 * every tick are `Value<Unit>` of the same unit, and the centre readout writes
 * that unit itself. Handed a whole `Reading`, a held figure is marked as held
 * and a model's interval puts two bounds on the arc.
 *
 * The dial is a `role="meter"` with the value as `aria-valuetext`. With no
 * value it draws no needle and is announced as an image naming the missing
 * value.
 *
 * @example A heading compass
 * ```tsx
 * import { value } from "@ksp-gonogo/sitrep-sdk";
 *
 * <Dial
 *   value={headingReading}
 *   min={value("°", 0)}
 *   max={value("°", 360)}
 *   wrap
 *   ticks={[
 *     { value: value("°", 0), label: "N" },
 *     { value: value("°", 90), label: "E" },
 *     { value: value("°", 180), label: "S" },
 *     { value: value("°", 270), label: "W" },
 *   ]}
 *   ariaLabel="Heading"
 * />
 * ```
 *
 * @category Gauge
 */
export function Dial<Unit extends string = string>({
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
}: Readonly<DialProps<Unit>>) {
  const resolved = resolveCurrency(value);
  const { shown, held, caption, band } = resolved;

  // The axis, unwrapped once into the face's angular geometry; every figure a reader sees goes back out through the unit layer.
  const current = shown?.magnitude ?? Number.NaN;
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
  // No number, no needle; a present but non-finite number still falls back to the start of the scale.
  const hasFigure = shown != null;
  const face = shown == null ? null : { magnitude: display, unit: shown.unit };
  // An SVG `<text>` cannot contain a `<span>`, so this uses `writeQuantity`, with `speakQuantity` for `aria-valuetext`.
  const centreLabel =
    valueLabel ?? (face === null ? null : writeQuantity(face, { format }));
  const spoken = face === null ? NULL_DISPLAY : speakQuantity(face, { format });
  // The model's interval, narrowed to the figure's own unit.
  const interval =
    shown == null || band === null ? null : (bandIn(band, shown.unit) ?? null);

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - TRACK_THICKNESS - 2;

  const angleOf = (v: number): number => {
    const t = span > 0 ? (v - axisMin) / span : 0;
    return startAngle + t * sweep;
  };

  /*
   * Onto the axis (clamped in the algebra, so another rung of the same kind
   * converts before it compares), then onto the face. Zone order and emptiness
   * are decided on quantities, since angles would flip under a negative sweep.
   */
  const onAxis = (q: Value<Unit>): Value<Unit> => q.max(min).min(max);
  const onFace = (q: Value<Unit>): number => angleOf(q.magnitude);

  // Compared as fractions of the sweep, from the angles the marks are drawn at.
  const onSweep = (angle: number): number =>
    sweep !== 0 ? (angle - startAngle) / sweep : 0;
  const drawnInterval =
    interval !== null &&
    standsApart(
      onSweep(angleOf(display)),
      [
        onSweep(onFace(onAxis(interval.lo))),
        onSweep(onFace(onAxis(interval.hi))),
      ],
      placedOnScale({ wraps: wrap }),
    )
      ? interval
      : null;

  const isFullCircle = sweep >= 360;
  const needle = pointAt(cx, cy, r * 0.88, angleOf(display));

  return (
    <Dial__Meter
      {...figureAttributes(resolved)}
      {...(hasFigure
        ? {
            role: "meter",
            "aria-label": sayHeld(ariaLabel ?? "Dial", caption),
            ...heldNameMarker(caption),
            "aria-valuenow": display,
            "aria-valuemin": axisMin,
            "aria-valuemax": axisMax,
            "aria-valuetext": spoken,
          }
        : {
            /* With no value to state, the face is an image rather than a meter at its minimum. */
            role: "img",
            "aria-label": sayHeld(`${ariaLabel ?? "Dial"}: ${spoken}`, caption),
            ...heldNameMarker(caption),
          })}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        style={{
          display: "block",
          fontFamily: "var(--font-family-mono)",
          maxWidth: "100%",
          height: "auto",
        }}
      >
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

        {r > 0 &&
          zones?.map((z) => {
            const lo = onAxis(z.from.min(z.to));
            const hi = onAxis(z.from.max(z.to));
            if (!hi.greaterThan(lo)) return null;
            return (
              <path
                key={`zone-${z.color}-${onFace(lo)}-${onFace(hi)}`}
                d={arcPath(cx, cy, r, onFace(lo), onFace(hi))}
                fill="none"
                stroke={z.color}
                strokeWidth={TRACK_THICKNESS}
                strokeLinecap="butt"
              />
            );
          })}

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

        {r > 0 &&
          drawnInterval !== null &&
          (["lo", "hi"] as const).map((end) => {
            const a = onFace(onAxis(drawnInterval[end]));
            const inner = pointAt(cx, cy, r - TRACK_THICKNESS / 2, a);
            const outer = pointAt(cx, cy, r + TRACK_THICKNESS / 2, a);
            return (
              <InstrumentBound
                key={end}
                end={end}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
              />
            );
          })}

        {r > 0 && hasFigure && (
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

        <text
          x={cx}
          y={cy + r * 0.55}
          textAnchor="middle"
          fontSize={13}
          fontWeight="bold"
          fill={
            centreLabel === null
              ? "var(--color-text-muted)"
              : "var(--color-text-primary)"
          }
        >
          {centreLabel ?? NULL_DISPLAY}
          {held && centreLabel !== null && <InstrumentHeldMark size={6} />}
        </text>
      </svg>
    </Dial__Meter>
  );
}

const Dial__Meter = styled.div`
  display: block;
  max-width: 100%;
`;
