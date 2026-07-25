/**
 * SiteMarker — the shared "you'll land HERE" target glyph: a ring + crosshair
 * ticks + centre dot. The SAME marker style is used on BOTH altimetry plots (the
 * top-down reticle's site and the side-on cross-section's landing point on the
 * terrain profile), so the predicted landing site reads consistently as a target
 * rather than an ambiguous dot.
 *
 * SVG fragment: render inside an existing `<svg>` at that svg's coordinates.
 */

export interface SiteMarkerProps {
  cx: number;
  cy: number;
  /** Ring/crosshair colour. Defaults to the accent foreground. */
  color?: string;
}

export function SiteMarker({
  cx,
  cy,
  color = "var(--color-accent-fg)",
}: Readonly<SiteMarkerProps>) {
  const r = 5;
  const t = 4; // crosshair tick reach beyond the ring
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
      <line
        x1={cx - r - t}
        y1={cy}
        x2={cx - r + 1}
        y2={cy}
        stroke={color}
        strokeWidth={1.5}
      />
      <line
        x1={cx + r - 1}
        y1={cy}
        x2={cx + r + t}
        y2={cy}
        stroke={color}
        strokeWidth={1.5}
      />
      <line
        x1={cx}
        y1={cy - r - t}
        x2={cx}
        y2={cy - r + 1}
        stroke={color}
        strokeWidth={1.5}
      />
      <line
        x1={cx}
        y1={cy + r - 1}
        x2={cx}
        y2={cy + r + t}
        stroke={color}
        strokeWidth={1.5}
      />
      <circle cx={cx} cy={cy} r={1.4} fill={color} />
    </g>
  );
}
