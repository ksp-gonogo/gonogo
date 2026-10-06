/**
 * What an instrument draws when its figure is a reading rather than a bare
 * quantity: the held mark, the model's two bounds, and the sentence a
 * screen reader hears.
 *
 * The vocabulary is `<Unit>`'s and `<Meter>`'s, in SVG: the held square is a tspan and
 * the bound is a line, with the same hue, shape and wording.
 */
import type { ReactNode } from "react";
import { RECKONING_MARK, type ReckoningKind } from "./reckoningMarkSpec";

/** How tall a lining digit stands above its baseline, and how far the mark's glyph does, each as a share of its own font size. */
const DIGIT_HEIGHT_EM = 0.72;
const GLYPH_TOP_EM = 0.76;

/**
 * The held mark, as an instrument can draw it.
 *
 * A superscript tspan in the readout's warning hue; a shape that is present or
 * absent, so nothing rests on telling amber from grey. Silent to a screen
 * reader: the instrument says it through {@link sayHeld}.
 *
 * Give `figureSize`, the font size of the figure it follows, wherever the
 * figure is much larger than the mark: the mark is then raised until its top
 * meets the top of the figure's digits. Without it the mark is raised by half
 * its own height, which is superscript only beside text of about its own size.
 *
 * @category Unit
 */
export function InstrumentHeldMark({
  size,
  kind = "held",
  figureSize,
}: {
  size: number;
  kind?: ReckoningKind;
  figureSize?: number;
}) {
  return (
    <tspan
      // Raised, so it reads as a mark on the figure rather than another figure.
      dy={
        figureSize === undefined
          ? -size * 0.55
          : -(figureSize * DIGIT_HEIGHT_EM - size * GLYPH_TOP_EM)
      }
      fontSize={size}
      fill={RECKONING_MARK[kind].color}
      data-held-mark=""
      data-reckoning-mark={kind}
    >
      {RECKONING_MARK[kind].glyph}
    </tspan>
  );
}

/**
 * One end of the model's interval, drawn across the instrument's own track.
 *
 * Two marks, never a shaded interval, as on `<Meter>`. The caller owns the
 * geometry; what is shared is how it looks.
 *
 * @category Unit
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
 * The accessible name with the held or modelled mark's words after it.
 * Nothing is appended when the figure is current.
 *
 * @category Unit
 */
export function sayHeld(name: string, caption: string | null): string {
  return caption === null ? name : `${name}, ${caption}`;
}

/**
 * The attribute that marks an element whose accessible name ends with a
 * {@link sayHeld} caption. Spread it on the element that carries that name.
 *
 * @category Unit
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
 *
 * @category Unit
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
