/**
 * What an instrument draws when its figure is a reading rather than a bare
 * quantity: the not-current mark, the model's two bounds, and the sentence a
 * screen reader hears.
 *
 * The vocabulary is `<Unit>`'s and `<Meter>`'s, in SVG. An instrument draws in
 * a medium where a span cannot go, so the dot is a tspan and the bound is a
 * line, but the hue, the shape and the wording are the same ones a readout
 * beside it uses. Nothing here is a second way of saying not current.
 */
import type { ReactNode } from "react";
import { severityDotColor } from "./status/severityDotColor";

/**
 * The not-current mark, as an instrument can draw it.
 *
 * An SVG text cannot hold a span, so the dot rides inside the readout as a
 * superscript tspan instead of hanging off a positioned box. It keeps what
 * carries the meaning: the same warning hue the panel badge and the readout dot
 * are painted from, and a SHAPE that is present or absent, so nothing rests on
 * telling amber from grey (WCAG 1.4.1).
 *
 * Silent to a screen reader. The instrument says it in words through
 * {@link sayHeld} on its accessible name, where a bullet read out after
 * every figure would only bury it.
 */
export function InstrumentHeldMark({ size }: { size: number }) {
  return (
    <tspan
      // Raised against the digits rather than sitting on the baseline, which is
      // what makes it read as a mark on the figure instead of another figure.
      dy={-size * 0.55}
      fontSize={size}
      fill={severityDotColor("warning")}
      data-not-current-mark=""
    >
      {"●"}
    </tspan>
  );
}

/**
 * One end of the model's interval, drawn across the instrument's own track.
 *
 * Two marks and never a shaded interval, the same choice the meter made: a
 * shaded span reads as a region the value is IN, and a band is a claim about
 * how well one number is known.
 *
 * The caller owns the geometry, because an arc, a rail and a face put a bound
 * in three different places. What is shared is how it looks, so two
 * instruments on one panel cannot draw the same claim two ways.
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
 * An instrument's name is an attribute and can only hold text, so the caption
 * goes on the end of it rather than into a hidden node the way a readout does.
 * Nothing is appended when the figure is current, so an unconverted instrument
 * announces exactly what it announced before.
 */
export function sayHeld(name: string, caption: string | null): string {
  return caption === null ? name : `${name}, ${caption}`;
}

/**
 * What an instrument shows in place of a needle when the reading carries no
 * number at all.
 *
 * A needle parked at the bottom of the scale is a READING: it says the value is
 * that. So an instrument with nothing to point at draws no pointer, and says so
 * where the figure would have gone.
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
