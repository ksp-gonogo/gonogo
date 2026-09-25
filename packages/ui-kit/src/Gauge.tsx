import { bandIn, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import {
  boundsStandApart,
  InstrumentBound,
  InstrumentHeldMark,
  InstrumentNoFigure,
  sayHeld,
} from "./instrumentCurrency";
import { NULL_DISPLAY } from "./NullValue";
import { resolveCurrency, type UnitValue } from "./readingCurrency";
import { type FormatsFor, speakQuantity, writeQuantity } from "./units";

/**
 * Half-circle gauge / dial: value displayed as a needle within a
 * `min..max` arc. Zones colour the arc to highlight ranges (e.g. red below
 * 1 and green above 1.5 for TWR). Compact (2:1 aspect) and readable at a
 * glance.
 *
 * The component is purely presentational: it draws the arc, the zones, the
 * needle, and the centre readout. The consumer supplies `value` from wherever
 * it reads telemetry.
 *
 * ## The axis is one kind, and the component says what it reads
 *
 * `value`, `min`, `max` and every zone bound are `Value<U>` of ONE unit, so a
 * zone in kilometres on a metre axis is a compile error rather than a needle
 * in the wrong place. The centre readout is written from that unit too: there
 * is no unit label to pass, because passing one is how a gauge came to be able
 * to show a number and a symbol that disagreed.
 *
 * ## Handed a whole `Reading`, it also draws how well the number is known
 *
 * `value` takes the reading it arrived in as readily as the quantity, and then
 * the gauge decides what to draw: a not-current reading marks the readout, a
 * model's interval puts a bound on the arc, and a reading carrying no number at
 * all shows no needle rather than parking one at the bottom of the scale.
 *
 * The AXIS is not widened with it. `min` and `max` are the scale the caller
 * chose to draw against, not something read from a vessel, so there is no
 * currency for them to carry.
 */
export interface GaugeZone<U extends string = string> {
  /** Lower bound of the zone (inclusive). */
  from: Value<U>;
  /** Upper bound of the zone (exclusive at the top end, except for the last zone). */
  to: Value<U>;
  /** CSS colour for this zone. */
  color: string;
}

export interface GaugeProps<U extends string = string> {
  /** The figure the needle points at, or the whole reading it arrived in. */
  value: UnitValue<U>;
  min: Value<U>;
  max: Value<U>;
  width: number;
  height: number;
  /** Optional zones drawn as coloured arc segments. Order doesn't matter. */
  zones?: ReadonlyArray<GaugeZone<U>>;
  /**
   * Pin the rung the centre readout is written at, for the cases where
   * convention beats magnitude. Absent, the value's own kind decides.
   */
  format?: FormatsFor<U>;
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

export function Gauge<U extends string = string>({
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
}: Readonly<GaugeProps<U>>) {
  // Split first, so the figure and the statements about it go separate ways.
  // Everything below works on the figure.
  const { shown, notCurrent, caption, band } = resolveCurrency(value);

  /*
   * The axis, unwrapped ONCE into the SVG's own coordinate space. Everything
   * below this line is trigonometry on bare numbers, which is what a path
   * command is made of; the type's work is already done, since one `U` across
   * value, min, max and every zone bound is what makes these four magnitudes
   * comparable at all. Every figure a READER sees goes back out through the
   * unit layer, at the centre readout and in the accessible name.
   */
  const v = shown?.magnitude ?? Number.NaN;
  const lo = min.magnitude;
  const hi = max.magnitude;
  const safeValue = Number.isFinite(v) ? v : lo;
  /*
   * Every OTHER quantity's way onto the arc, clamped in the algebra and
   * unwrapped once here. `min`/`max` convert before they compare, so a zone
   * bound written on another rung of the same kind lands where it belongs
   * rather than where its bare number would put it, which is the failure
   * `Math.max` on two magnitudes cannot see.
   */
  const onAxis = (q: Value<U>): number => q.max(min).min(max).magnitude;
  // A reading that carries no number gets no needle: one parked at the bottom
  // of the scale would say the value IS that. A number that is present but
  // non-finite is a different case and keeps the fallback to the foot of the
  // scale, which is where a bare quantity of the same shape lands.
  const hasFigure = shown != null;

  /*
   * An SVG `<text>` cannot contain a `<span>`, so `<Unit>` will not go in one
   * and `writeQuantity` is the sanctioned way out: it is the same formatter
   * and the same attach rule, rendered to a string.
   */
  const spoken =
    shown == null ? NULL_DISPLAY : speakQuantity(shown, { format });
  const centreLabel =
    valueLabel ?? (shown == null ? null : writeQuantity(shown, { format }));
  // Where the model would defend its answer, on the arc the needle swings over.
  // Narrowed to the figure's own unit: an interval placed by a number in
  // another kind is an interval about something else.
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

  // Pad the bounding box so the half-circle isn't clipped at the edges. The
  // arc lives in the upper half; reserve a strip below for the centre readout,
  // which is drawn at cy+18 and carries its own unit on the same line.
  const radius = Math.min(
    (width - TRACK_THICKNESS) / 2,
    height - TRACK_THICKNESS - 18,
  );

  const needle = useMemo(
    () => pointOnArc(safeValue, lo, hi, radius * 0.92),
    [safeValue, lo, hi, radius],
  );

  if (radius <= 0) {
    return (
      <svg
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        viewBox={`0 0 ${Math.max(0, width)} ${Math.max(0, height)}`}
        role="img"
        aria-label={sayHeld(ariaLabel ?? `Gauge: ${spoken}`, caption)}
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
      // `width`/`height` size the coordinate system (and the default
      // rendered box); the viewBox + `max-width: 100%; height: auto` pair
      // make that box responsive: if the actual slot is narrower than
      // `width` (e.g. a tall/narrow portrait widget column), the SVG
      // scales itself and its whole coordinate space down to fit instead
      // of overflowing and getting clipped by an ancestor's
      // `overflow: hidden`. No-op when the slot is already >= `width`.
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={sayHeld(ariaLabel ?? `Gauge: ${spoken}`, caption)}
      data-not-current={notCurrent ? "" : undefined}
      style={{
        display: "block",
        fontFamily: "monospace",
        maxWidth: "100%",
        height: "auto",
      }}
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
        {/* The model's two bounds, straddling the arc the needle swings over */}
        {bounds !== null &&
          (["lo", "hi"] as const).map((end) => {
            const at = pointOnArc(onAxis(bounds[end]), lo, hi, radius);
            // Radial, so the mark crosses the track rather than lying along it:
            // a tangential dash at this thickness reads as another zone.
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
        {/* Needle */}
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
      {/* Centre value, unit and all: see `centreLabel` on why it is a string */}
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
          {notCurrent && <InstrumentHeldMark size={7} />}
        </text>
      )}
    </svg>
  );
}
