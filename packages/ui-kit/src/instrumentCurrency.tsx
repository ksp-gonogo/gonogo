/**
 * What an instrument draws when its figure is a reading rather than a bare
 * quantity: the held mark, the model's two bounds, and the sentence a
 * screen reader hears.
 *
 * The vocabulary is `<Unit>`'s and `<Meter>`'s, in SVG: the dot is a tspan and
 * the bound is a line, with the same hue, shape and wording.
 */
import type { ReactNode } from "react";
import { severityDotColor } from "./status/severityDotColor";

/**
 * The held mark, as an instrument can draw it.
 *
 * A superscript tspan in the readout's warning hue; a shape that is present or
 * absent, so nothing rests on telling amber from grey. Silent to a screen
 * reader: the instrument says it through {@link sayHeld}.
 */
export function InstrumentHeldMark({ size }: { size: number }) {
  return (
    <tspan
      // Raised, so it reads as a mark on the figure rather than another figure.
      dy={-size * 0.55}
      fontSize={size}
      fill={severityDotColor("warning")}
      data-held-mark=""
    >
      {"●"}
    </tspan>
  );
}

/**
 * How far a model's bound has to sit from the observation, as a fraction of
 * the instrument's whole scale, before the bounds are drawn at all.
 *
 * One percent, the finest step a percentage readout writes.
 */
export const BAND_MARK_TOLERANCE = 0.01;

/**
 * Whether a model's bounds stand visibly apart from the observation, every
 * position a fraction of the scale, clamped to it first. `wraps` measures the
 * short way round a scale whose ends meet.
 */
export function boundsStandApart(
  observed: number,
  bounds: readonly number[],
  wraps = false,
): boolean {
  const onScale = (at: number): number =>
    wraps ? at - Math.floor(at) : Math.min(1, Math.max(0, at));
  const from = onScale(observed);
  return bounds.some((bound) => {
    const apart = Math.abs(onScale(bound) - from);
    return (wraps ? Math.min(apart, 1 - apart) : apart) > BAND_MARK_TOLERANCE;
  });
}

/**
 * One end of the model's interval, drawn across the instrument's own track.
 *
 * Two marks, never a shaded interval, as on `<Meter>`. The caller owns the
 * geometry; what is shared is how it looks.
 */
export function InstrumentBound({
  end,
  x1,
  y1,
  x2,
  y2,
}: {
  end: "lo" | "hi";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  return (
    <line
      data-bound={end}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="var(--color-text-primary)"
      strokeWidth={2}
      opacity={0.62}
      pointerEvents="none"
    />
  );
}

/**
 * The accessible name, with the currency said after it.
 *
 * Nothing is appended when the figure is current.
 */
export function sayHeld(name: string, caption: string | null): string {
  return caption === null ? name : `${name}, ${caption}`;
}

/**
 * The attribute that says the element's accessible name ends with a
 * {@link sayHeld} caption, which is how a render check tells an instrument that
 * announces its held mark from one that draws the mark silently.
 */
export function heldNameMarker(caption: string | null): {
  "data-currency-in-name"?: "";
} {
  return caption === null ? {} : { "data-currency-in-name": "" };
}

/**
 * What an instrument shows in place of a needle when the reading carries no
 * number at all.
 *
 * A needle parked at the bottom of the scale would be a reading, so an
 * instrument with nothing to point at draws no pointer.
 */
export function InstrumentNoFigure({
  x,
  y,
  size,
  children,
}: {
  x: number;
  y: number;
  size: number;
  children: ReactNode;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={size}
      fill="var(--color-text-muted)"
    >
      {children}
    </text>
  );
}
