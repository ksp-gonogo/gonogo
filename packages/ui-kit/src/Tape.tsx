/**
 * Tape — a vertical linear scale with a moving pointer, the altimeter/airspeed
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

import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

export interface TapeZone {
  /** Lower bound of the band, in value units. */
  from: number;
  /** Upper bound of the band, in value units. */
  to: number;
  /** Fill colour. Defaults to a faint warning tint. */
  color?: string;
  /** Short label drawn beside the band (also the text equivalent). */
  label?: string;
}

export interface TapeMarker {
  /** Value at which to draw the marker. */
  value: number;
  /** Marker colour. Defaults to the accent foreground. */
  color?: string;
  /** Short label drawn beside the marker (also the text equivalent). */
  label?: string;
}

export interface TapeProps {
  /** Current value — the pointer position. */
  value: number;
  /** Bottom of the scale. */
  min: number;
  /** Top of the scale. */
  max: number;
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
  /** Interior tick spacing in value units. Omit for no interior ticks. */
  tickStep?: number;
  zones?: ReadonlyArray<TapeZone>;
  markers?: ReadonlyArray<TapeMarker>;
  /** Draw a distinct ground line at this value (e.g. 0). */
  groundLine?: number;
  /** Unit suffix for the value + tick labels (e.g. "m"). */
  unit?: string;
  /** Label formatter. Defaults to a rounded number plus the unit. */
  format?: (v: number) => string;
  /** Accessible label (e.g. "Altitude above terrain"). Required for a11y. */
  ariaLabel?: string;
}

const PAD_TOP = 12;
const PAD_BOTTOM = 12;
// Left gutter wide enough for a 5-digit unit-less label (e.g. "10000").
const TRACK_X = 52;
const TRACK_W = 10;

function defaultFormat(v: number, unit?: string): string {
  const n = defaultNumber(v);
  return unit ? `${n} ${unit}` : `${n}`;
}

/** Compact number-only label for the on-scale ticks + pointer flag (the unit is
 * shown once as a header, so multi-digit values don't clip the narrow scale). */
function defaultNumber(v: number): string {
  const a = Math.abs(v);
  return a >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
}

export function Tape({
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
  unit,
  format,
  ariaLabel,
}: Readonly<TapeProps>) {
  // Full-height rail: measure the (stretched) wrapper and draw the scale at
  // that pixel height. The wrapper is `height:100%`, so its measured height is
  // parent-driven, not content-driven — no feedback loop with the SVG we size
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

  const span = max - min;
  const safe = Number.isFinite(value) ? value : min;
  const clamped = span > 0 ? Math.max(min, Math.min(max, safe)) : min;
  // `fmt` (with unit) is the accessible value text; `label` is the compact,
  // unit-less form drawn on the narrow scale so multi-digit values don't clip.
  const fmt = (v: number) => (format ? format(v) : defaultFormat(v, unit));
  const label = (v: number) => (format ? format(v) : defaultNumber(v));

  const usable = h - PAD_TOP - PAD_BOTTOM;
  // value -> y: max at the top (y = PAD_TOP), min at the bottom.
  const yOf = (v: number): number => {
    if (!(span > 0)) return PAD_TOP + usable;
    const t = Math.max(0, Math.min(1, (v - min) / span));
    return PAD_TOP + (1 - t) * usable;
  };

  const trackTop = PAD_TOP;
  const trackBottom = PAD_TOP + usable;
  const rightX = TRACK_X + TRACK_W + 6;

  const ticks: number[] = [];
  if (tickStep && tickStep > 0 && span > 0) {
    const first = Math.ceil(min / tickStep) * tickStep;
    for (let t = first; t <= max + 1e-9; t += tickStep) ticks.push(t);
  }

  const pointerY = yOf(clamped);

  return (
    <Tape__Meter
      ref={wrapRef}
      role="meter"
      aria-label={ariaLabel ?? "Tape"}
      aria-valuenow={clamped}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={fmt(safe)}
      style={fillHeight ? { height: "100%" } : undefined}
    >
      {/* The scale is decorative for a screen reader — the meter value above
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
          x={TRACK_X}
          y={trackTop}
          width={TRACK_W}
          height={usable}
          rx={2}
          fill="var(--color-surface-raised)"
        />

        {/* Zones */}
        {zones?.map((z) => {
          const lo = Math.min(z.from, z.to);
          const hi = Math.max(z.from, z.to);
          const yHi = yOf(hi);
          const yLo = yOf(lo);
          const h = Math.max(0, yLo - yHi);
          return (
            <g key={`zone-${lo}-${hi}-${z.label ?? ""}`}>
              <rect
                x={TRACK_X}
                y={yHi}
                width={TRACK_W}
                height={h}
                fill={z.color ?? "var(--color-status-warning-fg)"}
                opacity={0.55}
              />
              {z.label && (
                <text
                  x={rightX}
                  y={(yHi + yLo) / 2}
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
        {groundLine !== undefined && span > 0 && (
          <line
            x1={TRACK_X - 4}
            y1={yOf(groundLine)}
            x2={TRACK_X + TRACK_W + 4}
            y2={yOf(groundLine)}
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
                x1={TRACK_X - 4}
                y1={y}
                x2={TRACK_X}
                y2={y}
                stroke="var(--color-border-subtle)"
                strokeWidth={1}
              />
              <text
                x={TRACK_X - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={8}
                fill="var(--color-text-faint)"
              >
                {label(t)}
              </text>
            </g>
          );
        })}

        {/* Markers (to the right of the track) */}
        {markers?.map((m) => {
          const y = yOf(m.value);
          const color = m.color ?? "var(--color-accent-fg)";
          return (
            <g key={`marker-${m.value}-${m.label ?? ""}`}>
              <polygon
                points={`${TRACK_X + TRACK_W},${y} ${TRACK_X + TRACK_W + 5},${y - 3} ${TRACK_X + TRACK_W + 5},${y + 3}`}
                fill={color}
              />
              {m.label && (
                <text
                  x={rightX + 2}
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
        <line
          x1={TRACK_X - 6}
          y1={pointerY}
          x2={TRACK_X + TRACK_W + 6}
          y2={pointerY}
          stroke="var(--color-accent-fg)"
          strokeWidth={2}
        />
        <text
          x={TRACK_X - 8}
          y={Math.max(trackTop + 4, Math.min(trackBottom - 4, pointerY))}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={11}
          fontWeight="bold"
          fill="var(--color-accent-fg)"
        >
          {label(safe)}
        </text>

        {/* Unit shown once (the ticks + flag are unit-less to fit the scale). */}
        {unit && (
          <text
            x={TRACK_X + TRACK_W / 2}
            y={trackTop - 3}
            textAnchor="middle"
            fontSize={8}
            fill="var(--color-text-faint)"
          >
            {unit}
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
