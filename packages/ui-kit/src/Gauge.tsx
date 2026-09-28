import { bandIn, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import {
  boundsStandApart,
  heldNameMarker,
  InstrumentBound,
  InstrumentHeldMark,
  InstrumentNoFigure,
  sayHeld,
} from "./instrumentCurrency";
import { NULL_DISPLAY } from "./NullValue";
import { resolveCurrency, type UnitValue } from "./readingCurrency";
import { type FormatsFor, speakQuantity, writeQuantity } from "./units";

export interface GaugeZone<Unit extends string = string> {
  /** Lower bound of the zone (inclusive). */
  from: Value<Unit>;
  /** Upper bound of the zone (exclusive at the top end, except for the last zone). */
  to: Value<Unit>;
  /** CSS colour for this zone. */
  color: string;
}

export interface GaugeProps<Unit extends string = string> {
  /** The figure the needle points at, or the whole reading it arrived in. */
  value: UnitValue<Unit>;
  min: Value<Unit>;
  max: Value<Unit>;
  width: number;
  height: number;
  /** Optional zones drawn as coloured arc segments. Order doesn't matter. */
  zones?: ReadonlyArray<GaugeZone<Unit>>;
  /**
   * Pin the rung the centre readout is written at, for the cases where
   * convention beats magnitude. Absent, the value's own kind decides.
   */
  format?: FormatsFor<Unit>;
  /** Centre numeric label. Defaults to the value, written with its unit. */
  valueLabel?: string;
  /** Needle colour. Defaults to `var(--color-text-primary)`. */
  needleColor?: string;
  /** Arc track colour (the unfilled portion). Defaults to faint border. */
  trackColor?: string;
  /** ARIA label. Defaults to `Gauge: <value>`, spoken with its unit. */
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

/**
 * Half-circle gauge: a needle within a `min..max` arc, with zones colouring
 * ranges of it (e.g. red below 1 and green above 1.5 for TWR).
 *
 * `value`, `min`, `max` and every zone bound share one unit, so a zone in
 * kilometres on a metre axis is a compile error, and the centre readout is
 * written from that unit. Handed a whole `Reading`, a held figure marks
 * the readout, a model's interval puts two bounds on the arc, and no number
 * shows no needle. The axis itself is the caller's chosen scale and carries no
 * currency.
 */
export function Gauge<Unit extends string = string>({
  value,
  min,
  max,
  width,
  height,
  zones,
  format,
  valueLabel,
  needleColor = "var(--color-text-primary)",
  trackColor = "var(--color-border-subtle)",
  ariaLabel,
}: Readonly<GaugeProps<Unit>>) {
  const { shown, held, caption, band } = resolveCurrency(value);

  // The axis, unwrapped once into SVG coordinates; every figure a reader sees goes back out through the unit layer.
  const v = shown?.magnitude ?? Number.NaN;
  const lo = min.magnitude;
  const hi = max.magnitude;
  const safeValue = Number.isFinite(v) ? v : lo;
  // Clamped in the algebra, so a bound on another rung of the same kind converts before it compares.
  const onAxis = (q: Value<Unit>): number => q.max(min).min(max).magnitude;
  // No number, no needle; a present but non-finite number still falls back to the foot of the scale.
  const hasFigure = shown != null;

  // An SVG `<text>` cannot contain a `<span>`, so this uses `writeQuantity` rather than `<Unit>`.
  const spoken =
    shown == null ? NULL_DISPLAY : speakQuantity(shown, { format });
  const centreLabel =
    valueLabel ?? (shown == null ? null : writeQuantity(shown, { format }));
  // The model's interval, narrowed to the figure's own unit.
  const offered =
    shown == null || band === null ? null : (bandIn(band, shown.unit) ?? null);
  const onScale = (at: number): number => (hi > lo ? (at - lo) / (hi - lo) : 0);
  const bounds =
    offered !== null &&
    boundsStandApart(onScale(safeValue), [
      onScale(onAxis(offered.lo)),
      onScale(onAxis(offered.hi)),
    ])
      ? offered
      : null;

  // Pad the box so the arc is not clipped, and reserve a strip below for the centre readout.
  const radius = Math.min(
    (width - TRACK_THICKNESS) / 2,
    height - TRACK_THICKNESS - 18,
  );

  const needle = useMemo(
    () => pointOnArc(safeValue, lo, hi, radius * 0.92),
    [safeValue, lo, hi, radius],
  );

  const semantics = hasFigure
    ? {
        role: "meter",
        "aria-label": sayHeld(ariaLabel ?? "Gauge", caption),
        ...heldNameMarker(caption),
        "aria-valuenow": v,
        "aria-valuemin": lo,
        "aria-valuemax": hi,
        "aria-valuetext": spoken,
      }
    : {
        // With no value to state, the face is an image rather than a meter at its minimum.
        role: "img",
        "aria-label": sayHeld(ariaLabel ?? `Gauge: ${spoken}`, caption),
        ...heldNameMarker(caption),
      };

  if (radius <= 0) {
    return (
      <svg
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        viewBox={`0 0 ${Math.max(0, width)} ${Math.max(0, height)}`}
        {...semantics}
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
      >
        <title>{ariaLabel ?? "Gauge"}</title>
      </svg>
    );
  }

  // Translate so (0, 0) is the centre-bottom of the arc.
  const cx = width / 2;
  const cy = radius + TRACK_THICKNESS / 2;

  const trackPath = arcSegmentPath(lo, hi, lo, hi, radius);

  return (
    <svg
      width={width}
      height={height}
      // With `max-width: 100%`, the viewBox lets the SVG scale down to a slot narrower than `width` instead of being clipped.
      viewBox={`0 0 ${width} ${height}`}
      {...semantics}
      data-held={held ? "" : undefined}
      style={{
        display: "block",
        fontFamily: "var(--font-family-mono)",
        maxWidth: "100%",
        height: "auto",
      }}
    >
      <title>{sayHeld(ariaLabel ?? `Gauge: ${spoken}`, caption)}</title>
      <g transform={`translate(${cx} ${cy})`}>
        <path
          d={trackPath}
          stroke={trackColor}
          strokeWidth={TRACK_THICKNESS}
          fill="none"
          strokeLinecap="round"
        />
        {zones?.map((z, i) => {
          const from = onAxis(z.from);
          const to = onAxis(z.to);
          if (to <= from) return null;
          return (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: zones have no other identity
              key={`zone-${i}`}
              d={arcSegmentPath(from, to, lo, hi, radius)}
              stroke={z.color}
              strokeWidth={TRACK_THICKNESS}
              fill="none"
              strokeLinecap="butt"
            />
          );
        })}
        {bounds !== null &&
          (["lo", "hi"] as const).map((end) => {
            const at = pointOnArc(onAxis(bounds[end]), lo, hi, radius);
            // Radial, since a tangential dash at this thickness reads as another zone.
            const inner = radius - TRACK_THICKNESS / 2;
            const outer = radius + TRACK_THICKNESS / 2;
            return (
              <InstrumentBound
                key={end}
                end={end}
                x1={(at.x / radius) * inner}
                y1={(at.y / radius) * inner}
                x2={(at.x / radius) * outer}
                y2={(at.y / radius) * outer}
              />
            );
          })}
        {hasFigure && (
          <>
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
          </>
        )}
      </g>
      {centreLabel === null ? (
        <InstrumentNoFigure x={cx} y={cy + 18} size={16}>
          {NULL_DISPLAY}
        </InstrumentNoFigure>
      ) : (
        <text
          x={cx}
          y={cy + 18}
          textAnchor="middle"
          fontSize={16}
          fill="var(--color-text-primary)"
        >
          {centreLabel}
          {held && <InstrumentHeldMark size={7} />}
        </text>
      )}
    </svg>
  );
}
