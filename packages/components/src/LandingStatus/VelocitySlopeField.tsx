/**
 * VelocitySlopeField — the paired velocity + terrain-slope glyphs, drawn from a
 * shared origin so you read one against the other: am I drifting downhill,
 * uphill, or across the tilt? That velocity-relative-to-slope read is the real
 * tip-and-slide landing judgment, which is why the two are shown together.
 *
 * The two are deliberately DISTINCT representations so they're never confused:
 * - Velocity: a solid GREEN line from the origin (no arrowhead — the origin is
 *   obvious), length ∝ horizontal speed, along the travel bearing.
 * - Slope: neutral downhill GRADIENT TICKS (short contour-style strokes across
 *   the fall line, stepping downhill) — reads as terrain gradient, not a vector.
 *
 * SVG fragment: render inside an existing `<svg>`. Used by BOTH the reticle
 * overlay and the fixed-perspective box, so the pairing reads the same in each
 * view (consistency across views), while velocity vs slope stay distinct within.
 */

export interface VelocitySlopeFieldProps {
  /** Origin (shared tail) in the parent svg's coordinates. */
  cx: number;
  cy: number;
  /** Max glyph reach from the origin, in svg units. */
  radius: number;
  /** Travel bearing (deg clockwise from up/north). Null hides the velocity line. */
  velBearingDeg: number | null;
  /** Velocity line length as a fraction 0..1 of `radius`. */
  velFrac: number;
  /** Downhill bearing (deg clockwise from up/north). Null hides the slope ticks. */
  slopeBearingDeg: number | null;
}

/** Point at `deg` clockwise from up (north), `len` from (cx,cy). y grows down. */
function at(
  cx: number,
  cy: number,
  deg: number,
  len: number,
): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: cx + len * Math.sin(a), y: cy - len * Math.cos(a) };
}

export function VelocitySlopeField({
  cx,
  cy,
  radius,
  velBearingDeg,
  velFrac,
  slopeBearingDeg,
}: Readonly<VelocitySlopeFieldProps>) {
  const velLen = Math.max(0, Math.min(1, velFrac)) * radius;
  const velTip =
    velBearingDeg != null && velLen > 1
      ? at(cx, cy, velBearingDeg, velLen)
      : null;

  // Slope gradient ticks: short strokes ACROSS the fall line, stepping downhill.
  // Perpendicular unit vector to the downhill bearing gives each tick's span.
  const slopeTicks: Array<{ x1: number; y1: number; x2: number; y2: number }> =
    [];
  if (slopeBearingDeg != null) {
    const a = (slopeBearingDeg * Math.PI) / 180;
    const px = Math.cos(a); // perpendicular to (sin a, -cos a)
    const py = Math.sin(a);
    const half = radius * 0.16;
    for (const frac of [0.42, 0.62, 0.82]) {
      const c = at(cx, cy, slopeBearingDeg, radius * frac);
      slopeTicks.push({
        x1: c.x - px * half,
        y1: c.y - py * half,
        x2: c.x + px * half,
        y2: c.y + py * half,
      });
    }
  }

  return (
    <g>
      {/* Slope gradient ticks (neutral, distinct from the velocity line). */}
      {slopeTicks.map((t) => (
        <line
          key={`slope-${t.x1.toFixed(1)}-${t.y1.toFixed(1)}`}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="var(--color-text-dim)"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}
      {/* Velocity line (green, solid, no head). */}
      {velTip && (
        <line
          x1={cx}
          y1={cy}
          x2={velTip.x}
          y2={velTip.y}
          stroke="var(--color-accent-fg)"
          strokeWidth={2.5}
        />
      )}
    </g>
  );
}

/** Normalise a horizontal speed (m/s) to a 0..1 glyph fraction. */
export function velocityFraction(horizontalSpeed: number | null): number {
  if (horizontalSpeed == null || !Number.isFinite(horizontalSpeed)) return 0;
  return Math.min(1, Math.abs(horizontalSpeed) / 50);
}
