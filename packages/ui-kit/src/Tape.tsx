/**
 * Tape: a vertical linear scale with a moving pointer, the altimeter/airspeed
 * strip instrument. A ruler of values with a pointer at the current `value`,
 * marked `zones` (e.g. an ignition band), point `markers` (e.g. a gear-deploy
 * altitude) and an optional `groundLine`. Purely presentational.
 *
 * Renders as a `role="meter"` on the current value (aria-valuenow clamped into
 * range, aria-valuetext carrying the formatted value). The SVG scale is
 * `aria-hidden`, so the consuming widget owns a text summary of any zones or
 * markers an operator needs to hear.
 */

import { bandIn, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
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
import { type FormatsFor, quantityScale, speakQuantity } from "./units";

export interface TapeZone<U extends string = string> {
  /** Lower bound of the band. */
  from: Value<U>;
  /** Upper bound of the band. */
  to: Value<U>;
  /** Fill colour. Defaults to a faint warning tint. */
  color?: string;
  /** Short label drawn beside the band (also the text equivalent). */
  label?: string;
}

export interface TapeMarker<U extends string = string> {
  /** Value at which to draw the marker. */
  value: Value<U>;
  /** Marker colour. Defaults to the accent foreground. */
  color?: string;
  /** Short label drawn beside the marker (also the text equivalent). */
  label?: string;
}

export interface TapeProps<U extends string = string> {
  /**
   * Which side of the track the scale labels sit on. Default "left" (track
   * against the right edge). "right" mirrors it, for a tape down a widget's left
   * edge whose numbers should face the content.
   */
  labelSide?: "left" | "right";
  /** Current value: the pointer position, or the whole reading it arrived in. */
  value: UnitValue<U>;
  /** Bottom of the scale. */
  min: Value<U>;
  /** Top of the scale. */
  max: Value<U>;
  width?: number;
  height?: number;
  /**
   * Fill the parent's height instead of using a fixed `height`, as a
   * full-height rail beside the main content. `height` is the fallback until
   * the first measurement.
   */
  fillHeight?: boolean;
  /** Interior tick spacing. Omit for no interior ticks. */
  tickStep?: Value<U>;
  zones?: ReadonlyArray<TapeZone<U>>;
  markers?: ReadonlyArray<TapeMarker<U>>;
  /** Draw a distinct ground line at this value (e.g. 0). */
  groundLine?: Value<U>;
  /**
   * Pin the rung the whole scale is written at. Absent, the rung is taken from
   * `max` and held for every tick, the pointer flag and the unit header, so one
   * strip never mixes "500 m" and "1.0 km".
   */
  format?: FormatsFor<U>;
  /** Accessible label (e.g. "Altitude above terrain"). Required for a11y. */
  ariaLabel?: string;
}

const PAD_TOP = 12;
const PAD_BOTTOM = 12;
// Left gutter wide enough for a 5-digit unit-less label (e.g. "10000").
const TRACK_X = 52;
const TRACK_W = 10;

export function Tape<U extends string = string>({
  labelSide = "left",
  value,
  min,
  max,
  width = 92,
  height = 220,
  fillHeight = false,
  tickStep,
  zones,
  markers,
  groundLine,
  format,
  ariaLabel,
}: Readonly<TapeProps<U>>) {
  // The wrapper's height is parent-driven, so measuring it has no feedback loop with the SVG sized from it.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(height);
  useEffect(() => {
    if (!fillHeight) return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const h = el.clientHeight;
      if (h > 0) setMeasured(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fillHeight]);
  const h = fillHeight ? measured : height;

  const { shown, notCurrent, caption, band } = resolveCurrency(value);

  // Unwrapped once into pixel geometry; every figure a reader sees goes back out through the unit layer.
  const current = shown?.magnitude ?? Number.NaN;
  const axisMin = min.magnitude;
  const axisMax = max.magnitude;
  const span = axisMax - axisMin;
  const safe = Number.isFinite(current) ? current : axisMin;
  const clamped =
    span > 0 ? Math.max(axisMin, Math.min(axisMax, safe)) : axisMin;
  // No figure, no pointer: one resting at the foot of the rail would say the vessel is there.
  const hasFigure = shown != null;

  // One rung for the whole strip, so every mark and the head symbol agree.
  const scale = quantityScale(max, { format });
  const spoken =
    shown == null
      ? NULL_DISPLAY
      : speakQuantity(
          { magnitude: safe, unit: shown.unit },
          { format: scale.rung },
        );
  // The model's interval, narrowed to the figure's own unit: one in another kind is about something else.
  const interval =
    shown == null || band === null ? null : (bandIn(band, shown.unit) ?? null);

  // Floored: a squeezed `fillHeight` rail can measure under the padding, and SVG rejects a negative height.
  const usable = Math.max(0, h - PAD_TOP - PAD_BOTTOM);
  // value -> y: max at the top (y = PAD_TOP), min at the bottom.
  const yOf = (v: number): number => {
    if (!(span > 0)) return PAD_TOP + usable;
    const t = Math.max(0, Math.min(1, (v - axisMin) / span));
    return PAD_TOP + (1 - t) * usable;
  };

  // Zone ends are ordered in the value algebra (`min`/`max` convert first) before this unwraps them.
  const onRail = (q: Value<U>): number => yOf(q.magnitude);

  const trackTop = PAD_TOP;
  const trackBottom = PAD_TOP + usable;
  // Mirror the whole scale about the track when the labels read inboard.
  const mirrored = labelSide === "right";
  const trackX = mirrored ? width - TRACK_X - TRACK_W : TRACK_X;
  // The side the numeric scale is drawn on, and the opposite side used for zone/marker callouts.
  const labelX = mirrored ? trackX + TRACK_W + 6 : trackX - 6;
  const labelAnchor = mirrored ? "start" : "end";
  const rightX = mirrored ? trackX - 6 : trackX + TRACK_W + 6;
  const calloutAnchor = mirrored ? "end" : "start";

  const ground = groundLine?.magnitude;
  const ticks: number[] = [];
  const step = tickStep?.magnitude ?? 0;
  if (step > 0 && span > 0) {
    const first = Math.ceil(axisMin / step) * step;
    for (let t = first; t <= axisMax + 1e-9; t += step) ticks.push(t);
  }

  const pointerY = yOf(clamped);
  // Compared as fractions of the rail, from the heights the marks are drawn at.
  const onScale = (y: number): number =>
    usable > 0 ? (PAD_TOP + usable - y) / usable : 0;
  const drawnInterval =
    interval !== null &&
    boundsStandApart(onScale(pointerY), [
      onScale(onRail(interval.lo)),
      onScale(onRail(interval.hi)),
    ])
      ? interval
      : null;

  return (
    <Tape__Meter
      ref={wrapRef}
      data-not-current={notCurrent ? "" : undefined}
      {...(hasFigure
        ? {
            role: "meter",
            "aria-label": sayHeld(ariaLabel ?? "Tape", caption),
            ...heldNameMarker(caption),
            "aria-valuenow": clamped,
            "aria-valuemin": axisMin,
            "aria-valuemax": axisMax,
            "aria-valuetext": spoken,
          }
        : {
            /* A meter must state a value, so a figureless rail is an image instead. */
            role: "img",
            "aria-label": sayHeld(`${ariaLabel ?? "Tape"}: ${spoken}`, caption),
            ...heldNameMarker(caption),
          })}
      style={fillHeight ? { height: "100%" } : undefined}
    >
      <svg
        width={width}
        height={h}
        viewBox={`0 0 ${width} ${h}`}
        aria-hidden="true"
        style={
          fillHeight
            ? { display: "block", fontFamily: "var(--font-family-mono)" }
            : {
                display: "block",
                fontFamily: "var(--font-family-mono)",
                maxWidth: "100%",
                height: "auto",
              }
        }
      >
        {/* Track */}
        <rect
          x={trackX}
          y={trackTop}
          width={TRACK_W}
          height={usable}
          rx={2}
          fill="var(--color-surface-raised)"
        />

        {/* Zones */}
        {zones?.map((z) => {
          const yHi = onRail(z.from.max(z.to));
          const yLo = onRail(z.from.min(z.to));
          const h = Math.max(0, yLo - yHi);
          return (
            <g key={`zone-${yLo}-${yHi}-${z.label ?? ""}`}>
              <rect
                x={trackX}
                y={yHi}
                width={TRACK_W}
                height={h}
                fill={z.color ?? "var(--color-status-warning-bg)"}
                opacity={0.55}
              />
              {z.label && (
                <text
                  x={rightX}
                  y={(yHi + yLo) / 2}
                  textAnchor={calloutAnchor}
                  dominantBaseline="middle"
                  fontSize={9}
                  fill="var(--color-text-faint)"
                >
                  {z.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Ground line */}
        {ground !== undefined && span > 0 && (
          <line
            x1={trackX - 4}
            y1={yOf(ground)}
            x2={trackX + TRACK_W + 4}
            y2={yOf(ground)}
            stroke="var(--color-text-primary)"
            strokeWidth={2}
          />
        )}

        {/* Interior ticks and labels */}
        {ticks.map((t) => {
          const y = yOf(t);
          return (
            <g key={`tick-${t}`}>
              <line
                x1={mirrored ? trackX + TRACK_W + 4 : trackX - 4}
                y1={y}
                x2={mirrored ? trackX + TRACK_W : trackX}
                y2={y}
                stroke="var(--color-border-subtle)"
                strokeWidth={1}
              />
              <text
                x={labelX}
                y={y}
                textAnchor={labelAnchor}
                dominantBaseline="middle"
                fontSize={8}
                fill="var(--color-text-faint)"
              >
                {scale.mark(t)}
              </text>
            </g>
          );
        })}

        {/* Markers */}
        {markers?.map((m) => {
          const y = onRail(m.value);
          const color = m.color ?? "var(--color-accent-fg)";
          return (
            <g key={`marker-${y}-${m.label ?? ""}`}>
              <polygon
                points={
                  mirrored
                    ? `${trackX},${y} ${trackX - 5},${y - 3} ${trackX - 5},${y + 3}`
                    : `${trackX + TRACK_W},${y} ${trackX + TRACK_W + 5},${y - 3} ${trackX + TRACK_W + 5},${y + 3}`
                }
                fill={color}
              />
              {m.label && (
                <text
                  x={mirrored ? rightX - 2 : rightX + 2}
                  textAnchor={calloutAnchor}
                  y={y}
                  dominantBaseline="middle"
                  fontSize={9}
                  fill={color}
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}

        {/* The model's two bounds, across the rail */}
        {drawnInterval !== null &&
          (["lo", "hi"] as const).map((end) => {
            const y = onRail(drawnInterval[end]);
            return (
              <InstrumentBound
                key={end}
                end={end}
                x1={trackX}
                y1={y}
                x2={trackX + TRACK_W}
                y2={y}
              />
            );
          })}

        {hasFigure && (
          <>
            <line
              x1={trackX - 6}
              y1={pointerY}
              x2={trackX + TRACK_W + 6}
              y2={pointerY}
              stroke="var(--color-accent-fg)"
              strokeWidth={2}
            />
            <text
              x={mirrored ? labelX + 2 : labelX - 2}
              y={Math.max(trackTop + 4, Math.min(trackBottom - 4, pointerY))}
              textAnchor={labelAnchor}
              dominantBaseline="middle"
              fontSize={11}
              fontWeight="bold"
              fill="var(--color-accent-fg)"
            >
              {scale.mark(safe)}
              {notCurrent && <InstrumentHeldMark size={5} />}
            </text>
          </>
        )}
        {!hasFigure && (
          <InstrumentNoFigure
            x={mirrored ? labelX + 8 : labelX - 8}
            y={trackTop + usable / 2}
            size={11}
          >
            {NULL_DISPLAY}
          </InstrumentNoFigure>
        )}

        {/* The scale's symbol, shown once; ticks and the flag stay symbol-less to fit the strip. */}
        {scale.symbol !== "" && (
          <text
            x={trackX + TRACK_W / 2}
            y={trackTop - 3}
            textAnchor="middle"
            fontSize={8}
            fill="var(--color-text-faint)"
          >
            {scale.symbol}
          </text>
        )}
      </svg>
    </Tape__Meter>
  );
}

const Tape__Meter = styled.div`
  display: block;
  max-width: 100%;
`;
