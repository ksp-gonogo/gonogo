/**
 * DirectionArrow — the one shared "a vector points this way" glyph for the
 * landing instrument. A line from an origin to a tip with an arrowhead, drawn
 * in a caller-chosen colour. Used by BOTH the velocity vector (the resultant of
 * descent + lateral drift) and the touchdown reticle (the downhill slope
 * direction) so the same green arrow means "direction" everywhere, oriented per
 * its own data rather than being two look-alike ad-hoc lines.
 *
 * SVG fragment: render inside an existing `<svg>` at that svg's coordinates.
 */

export interface DirectionArrowProps {
  /** Tail (origin) of the arrow, in the parent svg's coordinates. */
  x1: number;
  y1: number;
  /** Head (tip) of the arrow. */
  x2: number;
  y2: number;
  /** Stroke + fill colour (a CSS colour or `var(--…)` token). */
  color: string;
  strokeWidth?: number;
  /** Arrowhead length in svg units. */
  headLength?: number;
}

export function DirectionArrow({
  x1,
  y1,
  x2,
  y2,
  color,
  strokeWidth = 2.5,
  headLength = 8,
}: Readonly<DirectionArrowProps>) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = 0.42;
  const hx1 = x2 - headLength * Math.cos(angle - spread);
  const hy1 = y2 - headLength * Math.sin(angle - spread);
  const hx2 = x2 - headLength * Math.cos(angle + spread);
  const hy2 = y2 - headLength * Math.sin(angle + spread);
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={strokeWidth}
      />
      <polygon
        points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`}
        fill={color}
      />
    </g>
  );
}
