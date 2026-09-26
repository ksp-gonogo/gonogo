/**
 * Tape: a vertical linear scale with a moving pointer, the altimeter/airspeed
 * "strip" instrument. A ruler of values with a fixed pointer at the current
 * `value`, marked `zones` (e.g. a suicide-burn ignition band), point `markers`
 * (e.g. a gear-deploy altitude or a projected-touchdown tick), and an optional
 * `groundLine`. Purely presentational: map data in via props.
 *
 * Nothing in the kit did a moving-scale before this. It is deliberately generic
 * (altitude, speed, throttle, temperature) rather than landing-specific.
 * 📌 Revisit (landing-widget plan A1): confirm after first real use whether Tape
 * belongs in ui-kit or demotes into the widget.
 *
 * Semantics: renders as a `role="meter"` on the current value (aria-valuenow
 * clamped into range, aria-valuetext carrying the true formatted value), so a
 * screen reader announces the reading. The SVG scale itself is `aria-hidden`
 * (it is a visual aid); the consuming widget is responsible for a text summary
 * of any zones/markers that a non-sighted operator needs.
 */

import { bandIn, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import {
  boundsStandApart,
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
   * Which side of the track the scale labels sit on. Default "left", the track
   * hard against the right edge with its numbers outboard.
   *
   * "right" mirrors it: the track hugs the left edge and the numbers read
   * inboard. That is what a tape running down the LEFT edge of a widget wants,
   * so its numbers face the content they annotate instead of the panel border.
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
   * Fill the parent's height instead of using a fixed `height`. The tape
   * becomes a full-height rail: a ResizeObserver measures the wrapper (which
   * stretches to the parent) and the scale is drawn at that pixel height with
   * the fixed `width`. Use inside a flex row where the tape should run the full
   * height of the widget beside the main content. `height` is the pre-measure
   * fallback.
   */
  fillHeight?: boolean;
  /** Interior tick spacing. Omit for no interior ticks. */
  tickStep?: Value<U>;
  zones?: ReadonlyArray<TapeZone<U>>;
  markers?: ReadonlyArray<TapeMarker<U>>;
  /** Draw a distinct ground line at this value (e.g. 0). */
  groundLine?: Value<U>;
  /**
   * Pin the rung the whole scale is written at, for the cases where convention
   * beats magnitude.
   *
   * Absent, the rung is taken from `max` and held for every tick, the pointer
   * flag and the unit header alike, so the scale reads as one ruler. Letting
   * each label ladder on its own magnitude is what would put "500 m" and
   * "1.0 km" on the same strip.
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
  // Full-height rail: measure the (stretched) wrapper and draw the scale at
  // that pixel height. The wrapper is `height:100%`, so its measured height is
  // parent-driven, not content-driven: no feedback loop with the SVG we size
  // from it. `height` is the fallback until the first measurement lands.
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

  // Split first, so the figure and the statements about it go separate ways.
  const { shown, notCurrent, caption, band } = resolveCurrency(value);

  /*
   * The scale, unwrapped ONCE into the strip's own pixel geometry. Everything
   * below is arithmetic on bare numbers, which is what a `y` coordinate is
   * made of; one `U` across value, min, max, tickStep, zones and markers is
   * what makes these magnitudes belong on one ruler at all. Every figure a
   * READER sees goes back out through the unit layer, at the tick labels, the
   * pointer flag, the unit header and `aria-valuetext`.
   */
  const current = shown?.magnitude ?? Number.NaN;
  const axisMin = min.magnitude;
  const axisMax = max.magnitude;
  const span = axisMax - axisMin;
  const safe = Number.isFinite(current) ? current : axisMin;
  const clamped =
    span > 0 ? Math.max(axisMin, Math.min(axisMax, safe)) : axisMin;
  // A reading carrying no number gets no pointer: one resting at the foot of
  // the rail would say the vessel is there. A number that is present but
  // non-finite keeps the fallback to the foot of the rail.
  const hasFigure = shown != null;

  /*
   * One rung for the whole strip, settled from the top of it (or from the
   * caller's pin). `quantityScale` owns that rule, so the marks below cannot
   * drift onto rungs of their own and the symbol shown at the head is the one
   * they are actually printed in.
   */
  const scale = quantityScale(max, { format });
  const spoken =
    shown == null
      ? NULL_DISPLAY
      : speakQuantity(
          { magnitude: safe, unit: shown.unit },
          { format: scale.rung },
        );
  // Where the model would defend its answer, on the rail the pointer runs up.
  // Narrowed to the figure's own unit: an interval placed by a number of
  // another kind is an interval about something else.
  const interval =
    shown == null || band === null ? null : (bandIn(band, shown.unit) ?? null);

  // Floored: a `fillHeight` rail measures whatever the surrounding layout
  // leaves it (e.g. LandingStatus's AltitudeRail squeezed by sibling
  // content at a small tile size), and can come in under the fixed top+bottom
  // padding. An unclamped `usable` then goes negative and the track `<rect>`
  // below throws (SVG rejects a negative `height`). Flooring at 0 degrades
  // to a collapsed track instead of a crash.
  const usable = Math.max(0, h - PAD_TOP - PAD_BOTTOM);
  // value -> y: max at the top (y = PAD_TOP), min at the bottom.
  const yOf = (v: number): number => {
    if (!(span > 0)) return PAD_TOP + usable;
    const t = Math.max(0, Math.min(1, (v - axisMin) / span));
    return PAD_TOP + (1 - t) * usable;
  };

  /*
   * A quantity's way onto the rail, and the single unwrap on that path. `yOf`
   * already pins anything off the ends of the scale, so what this adds is the
   * ordering being done in the ALGEBRA: `min`/`max` convert before they
   * compare, and a zone written on another rung of the same kind is otherwise
   * ordered by its bare number, which `Math.min` on two magnitudes cannot see.
   */
  const onRail = (q: Value<U>): number => yOf(q.magnitude);

  const trackTop = PAD_TOP;
  const trackBottom = PAD_TOP + usable;
  // Mirror the whole scale about the track when the labels read inboard.
  const mirrored = labelSide === "right";
  const trackX = mirrored ? width - TRACK_X - TRACK_W : TRACK_X;
  // The side the numeric scale is drawn on, and the opposite side used for
  // zone/marker callouts.
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
            "aria-valuenow": clamped,
            "aria-valuemin": axisMin,
            "aria-valuemax": axisMax,
            "aria-valuetext": spoken,
          }
        : {
            /* A meter must state a value, and there is none: the rail is
               announced as a picture of nothing rather than as its foot. */
            role: "img",
            "aria-label": sayHeld(`${ariaLabel ?? "Tape"}: ${spoken}`, caption),
          })}
      style={fillHeight ? { height: "100%" } : undefined}
    >
      {/* The scale is decorative for a screen reader, the meter value above
          carries the reading; zone/marker labels are visual aids. */}
      <svg
        width={width}
        height={h}
        viewBox={`0 0 ${width} ${h}`}
        aria-hidden="true"
        style={
          fillHeight
            ? { display: "block", fontFamily: "monospace" }
            : {
                display: "block",
                fontFamily: "monospace",
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

        {/* Interior ticks + labels (to the left of the track) */}
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

        {/* Markers (to the right of the track) */}
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

        {/* Current-value pointer + flag */}
        {/* Spans the track, so it follows the mirror. Pinning it to the
            unmirrored TRACK_X leaves the pointer on the opposite side from the
            track it points at whenever labelSide flips. */}
        {/* The model's two bounds, across the rail the pointer runs up */}
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

        {/* The scale's own symbol, shown once, taken from the same rung every
            tick and the pointer flag are written at (those stay symbol-less to
            fit the narrow strip). Empty for a kind that displays none. */}
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
