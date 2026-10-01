import { bandIn, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import {
  heldNameMarker,
  InstrumentBound,
  InstrumentHeldMark,
  InstrumentNoFigure,
  sayHeld,
} from "./instrumentCurrency";
import { NULL_DISPLAY } from "./NullValue";
import {
  figureAttributes,
  resolveCurrency,
  type UnitValue,
} from "./readingCurrency";
import { placedOnScale, standsApart } from "./standsApart";
import { useTooltip } from "./Tooltip";
import { type FormatsFor, quantityScale, speakQuantity } from "./units";

/**
 * A shaded band on a {@link Tape}'s scale, such as an ignition band.
 *
 * @category Gauge
 */
export interface TapeZone<Unit extends string = string> {
  /** Lower bound of the band. */
  from: Value<Unit>;
  /** Upper bound of the band. */
  to: Value<Unit>;
  /** Fill colour. Defaults to a faint warning tint. */
  color?: string;
  /** Names the band in the meter's spoken value. Never drawn: the band's colour and place say what it is. */
  label?: string;
}

/**
 * A point marker on a {@link Tape}'s scale, such as a gear-deploy altitude.
 *
 * @category Gauge
 */
export interface TapeMarker<Unit extends string = string> {
  /** Value at which to draw the marker. */
  value: Value<Unit>;
  /** Marker colour. Defaults to the accent foreground. */
  color?: string;
  /** Names the marker in the meter's spoken value. Never drawn, so a marker never competes with the scale for room. */
  label?: string;
  /** The model's interval around `value`, drawn as the same two bounds a {@link Meter} draws. */
  bounds?: { lo: Value<Unit>; hi: Value<Unit> };
}

/**
 * Props for {@link Tape}.
 *
 * @category Gauge
 */
export interface TapeProps<Unit extends string = string> {
  /**
   * Which side of the track the scale labels sit on. Default "left" (track
   * against the right edge). "right" mirrors it, for a tape down a widget's left
   * edge whose numbers should face the content.
   */
  labelSide?: "left" | "right";
  /** Current value: the pointer position, or the whole reading it arrived in. */
  value: UnitValue<Unit>;
  /** Bottom of the scale. */
  min: Value<Unit>;
  /** Top of the scale. */
  max: Value<Unit>;
  /**
   * Drawn width in pixels.
   *
   * @defaultValue `92`
   */
  width?: number;
  /**
   * Drawn height in pixels.
   *
   * @defaultValue `220`
   */
  height?: number;
  /**
   * Fill the parent's height instead of using a fixed `height`, as a
   * full-height rail beside the main content. `height` is the fallback until
   * the first measurement.
   */
  fillHeight?: boolean;
  /** Interior tick spacing. Omit for no interior ticks. */
  tickStep?: Value<Unit>;
  /** Shaded bands on the scale. */
  zones?: ReadonlyArray<TapeZone<Unit>>;
  /** Point markers on the scale. */
  markers?: ReadonlyArray<TapeMarker<Unit>>;
  /** Draw a distinct ground line at this value (e.g. 0). Always drawn: off the scale it is pinned to the edge it lies beyond, with a chevron pointing out. */
  groundLine?: Value<Unit>;
  /** Draw a sea-level line at this value, a dashed twin of the ground line with the same edge-pinning. */
  seaLevel?: Value<Unit>;
  /**
   * Pin the rung the whole scale is written at. Absent, the rung is taken from
   * `max` and held for every tick, the pointer flag and the unit header, so one
   * strip never mixes "500 m" and "1.0 km".
   */
  format?: FormatsFor<Unit>;
  /** Accessible label naming what the scale measures (e.g. "Altitude above terrain"). */
  ariaLabel: string;
}

const PAD_TOP = 12;
const PAD_BOTTOM = 12;
// Left gutter wide enough for a 5-digit unit-less label (e.g. "10000").
const TRACK_X = 52;
const TRACK_W = 10;

/**
 * A vertical linear scale with a moving pointer, the altimeter or airspeed
 * strip instrument. A ruler of values with a pointer at the current `value`,
 * marked `zones` (e.g. an ignition band), point `markers` (e.g. a gear-deploy
 * altitude) and an optional `groundLine`.
 *
 * With no value it draws no pointer. Handed a whole `Reading`, a held figure
 * is marked as held and a model's interval puts two bounds on the scale.
 *
 * Renders as a `role="meter"` on the current value (`aria-valuenow` clamped
 * into range, `aria-valuetext` carrying the written value). The SVG scale is
 * `aria-hidden`, so the widget using it provides a text summary of any zones or
 * markers an operator needs to hear.
 *
 * @category Gauge
 */
export function Tape<Unit extends string = string>({
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
  seaLevel,
  format,
  ariaLabel,
}: Readonly<TapeProps<Unit>>) {
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

  const resolved = resolveCurrency(value);
  const { shown, held, caption, band } = resolved;
  const { anchor, tip } = useTooltip(caption);

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
  // Each mark picks its own rung, so a band's two ends are not rounded onto the same figure by the scale's.
  const said = (q: Value<Unit>): string => speakQuantity(q);
  const spokenMarks = [
    ...(markers ?? []).flatMap((m) =>
      m.label === undefined
        ? []
        : [
            m.bounds === undefined
              ? `${m.label} ${said(m.value)}`
              : `${m.label} ${said(m.value)}, between ${said(m.bounds.lo)} and ${said(m.bounds.hi)}`,
          ],
    ),
    ...(zones ?? []).flatMap((z) =>
      z.label === undefined
        ? []
        : [
            `${z.label} zone ${said(z.from.min(z.to))} to ${said(z.from.max(z.to))}`,
          ],
    ),
    ...(groundLine === undefined ? [] : [`ground ${said(groundLine)}`]),
    ...(seaLevel === undefined ? [] : [`sea level ${said(seaLevel)}`]),
  ];
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
  const onRail = (q: Value<Unit>): number => yOf(q.magnitude);

  const trackTop = PAD_TOP;
  const trackBottom = PAD_TOP + usable;
  // Mirror the whole scale about the track when the labels read inboard.
  const mirrored = labelSide === "right";
  const trackX = mirrored ? width - TRACK_X - TRACK_W : TRACK_X;
  // The side the numeric scale is drawn on.
  const labelX = mirrored ? trackX + TRACK_W + 6 : trackX - 6;
  const labelAnchor = mirrored ? "start" : "end";

  // A level beyond either end sits on that edge with a chevron pointing out, so it is never lost off the rail.
  const drawLevel = (at: Value<Unit>, dashed: boolean) => {
    const y = onRail(at);
    const beyond = at.greaterThan(max) ? -1 : at.lessThan(min) ? 1 : 0;
    const x1 = trackX - 4;
    const x2 = trackX + TRACK_W + 4;
    const mid = trackX + TRACK_W / 2;
    return (
      <g data-level={dashed ? "sea" : "ground"}>
        <line
          x1={x1}
          y1={y}
          x2={x2}
          y2={y}
          stroke={
            dashed ? "var(--color-info-mark)" : "var(--color-text-primary)"
          }
          strokeWidth={dashed ? 1.5 : 2}
          strokeDasharray={dashed ? "3 2" : undefined}
        />
        {beyond !== 0 && (
          <polygon
            data-off-scale="true"
            points={`${mid - 4},${y - beyond * 2} ${mid + 4},${y - beyond * 2} ${mid},${y + beyond * 4}`}
            fill={
              dashed ? "var(--color-info-mark)" : "var(--color-text-primary)"
            }
          />
        )}
      </g>
    );
  };
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
    standsApart(
      onScale(pointerY),
      [onScale(onRail(interval.lo)), onScale(onRail(interval.hi))],
      placedOnScale(),
    )
      ? interval
      : null;

  return (
    <Tape__Meter
      ref={wrapRef}
      {...figureAttributes(resolved)}
      {...anchor}
      {...(hasFigure
        ? {
            role: "meter",
            "aria-label": sayHeld(ariaLabel, caption),
            ...heldNameMarker(caption),
            "aria-valuenow": clamped,
            "aria-valuemin": axisMin,
            "aria-valuemax": axisMax,
            "aria-valuetext":
              spokenMarks.length === 0
                ? spoken
                : `${spoken}; ${spokenMarks.join("; ")}`,
          }
        : {
            /* A meter must state a value, so a figureless rail is an image instead. */
            role: "img",
            "aria-label": sayHeld(`${ariaLabel}: ${spoken}`, caption),
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
                fill={z.color ?? "var(--color-warn-mark)"}
                opacity={0.55}
              />
            </g>
          );
        })}

        {/* Sea level under ground, so where they coincide the heavier ground line reads on top */}
        {seaLevel !== undefined && span > 0 && drawLevel(seaLevel, true)}
        {groundLine !== undefined && span > 0 && drawLevel(groundLine, false)}

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
          const { bounds } = m;
          const y = onRail(m.value);
          const color = m.color ?? "var(--color-accent-fg)";
          return (
            <g key={`marker-${y}-${m.label ?? ""}`} data-marker={m.label}>
              {/* Dashed and hollow, where the observed pointer is a solid bar, so a model's figure is never mistaken for a measurement */}
              <line
                x1={trackX}
                y1={y}
                x2={trackX + TRACK_W}
                y2={y}
                stroke={color}
                strokeWidth={2}
                strokeDasharray="2 2"
              />
              <polygon
                points={
                  mirrored
                    ? `${trackX},${y} ${trackX - 5},${y - 3} ${trackX - 5},${y + 3}`
                    : `${trackX + TRACK_W},${y} ${trackX + TRACK_W + 5},${y - 3} ${trackX + TRACK_W + 5},${y + 3}`
                }
                fill="none"
                stroke={color}
                strokeWidth={1.5}
              />
              {bounds !== undefined &&
                (["lo", "hi"] as const).map((end) => {
                  const by = onRail(bounds[end]);
                  return (
                    <InstrumentBound
                      key={end}
                      end={end}
                      x1={trackX}
                      y1={by}
                      x2={trackX + TRACK_W}
                      y2={by}
                    />
                  );
                })}
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
              {held && <InstrumentHeldMark size={5} />}
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
      {tip}
    </Tape__Meter>
  );
}

const Tape__Meter = styled.div`
  display: block;
  max-width: 100%;
`;
