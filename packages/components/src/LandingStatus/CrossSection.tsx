/**
 * CrossSection — the SIDE-ON altimetry plot, paired with the top-down reticle.
 * It slices the terrain patch ALONG THE GROUND TRACK (the horizontal-velocity
 * bearing) through the site and draws that height profile as a vertical terrain
 * cross-section. Two SEPARATE things ride over it: the predicted landing site,
 * marked on the terrain profile (the shared target marker), and an ACCURATE
 * velocity vector from the vessel's current position (above the terrain) — true
 * descent angle, length ∝ speed — which is free to cut off in mid-air (it is
 * current motion, not a line to the site). Speeds also ride the ↓/→ labels.
 *
 * Purely presentational. No arrowheads (standing rule); a clean side elevation.
 * The accessible name carries the numbers so the picture is never the sole
 * carrier (and matches the reticle's descent/ground-speed wording).
 */

import { SiteMarker } from "./SiteMarker";

const SIZE = 160;

export interface CrossSectionProps {
  /** Flattened row-major NxN terrain-height grid. */
  patch?: readonly number[] | null;
  /** The N of the NxN patch. */
  patchSize?: number | null;
  /** Ground-track bearing (deg cw from north) to slice along. */
  bearingDeg?: number | null;
  /** Descent rate, m/s (down-positive). */
  verticalSpeed: number | null;
  /** Horizontal (ground) speed, m/s. */
  horizontalSpeed: number | null;
  /** Height above terrain, metres — drives the vessel's descent down the plot. */
  aglMeters?: number | null;
}

function fmtSpeed(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)} m/s`;
}

/** Bilinear sample of a normalised grid at continuous (col,row). */
function bilinear(
  norm: number[],
  size: number,
  col: number,
  row: number,
): number {
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(col)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(row)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, col - x0));
  const fy = Math.max(0, Math.min(1, row - y0));
  const a = norm[y0 * size + x0];
  const b = norm[y0 * size + x1];
  const c = norm[y1 * size + x0];
  const d = norm[y1 * size + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Sample the normalised height profile along `bearingDeg` through the centre. */
function sliceProfile(
  patch: readonly number[] | null | undefined,
  size: number | null | undefined,
  bearingDeg: number | null | undefined,
): number[] | null {
  if (!patch || !size || size < 2 || patch.length < size * size) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < size * size; i++) {
    const h = patch[i];
    if (!Number.isFinite(h)) return null;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const range = hi - lo;
  const norm = new Array<number>(size * size);
  for (let i = 0; i < size * size; i++) {
    norm[i] = range > 0 ? (patch[i] - lo) / range : 0.5;
  }
  const th = ((bearingDeg ?? 0) * Math.PI) / 180;
  const dcol = Math.sin(th);
  const drow = -Math.cos(th);
  const c0 = (size - 1) / 2;
  const half = (size - 1) / 2;
  const steps = size * 2;
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -half + 2 * half * (i / steps);
    out.push(bilinear(norm, size, c0 + t * dcol, c0 + t * drow));
  }
  return out;
}

export function CrossSection({
  patch,
  patchSize,
  bearingDeg,
  verticalSpeed,
  horizontalSpeed,
  aglMeters,
}: Readonly<CrossSectionProps>) {
  const profile = sliceProfile(patch, patchSize, bearingDeg);
  const label = `Descent ${fmtSpeed(verticalSpeed)}, ground speed ${fmtSpeed(
    horizontalSpeed,
  )}`;

  const pad = 8;
  const plotW = SIZE - pad * 2;
  const baseY = SIZE - 16;
  const topY = 30;
  // Terrain amplitude kept modest so there's sky headroom above it for the
  // descending vessel + its velocity vector (which must never clip the surface).
  const amp = (baseY - topY) * 0.55;

  // Terrain rendered as JUST the top surface line (the skyline): an open polyline
  // of the profile points, over a soft closed fill that reads "ground below".
  // No bottom/closure line and no ground baseline — only the top terrain line.
  let topLine = ""; // open polyline: the surface profile only
  let fillArea = ""; // closed polygon (fill only, no stroke): ground beneath
  if (profile) {
    const pts = profile.map((h, i) => {
      const x = pad + plotW * (i / (profile.length - 1));
      const y = baseY - h * amp;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    topLine = pts.join(" ");
    fillArea = `${pad},${baseY} ${pts.join(" ")} ${pad + plotW},${baseY}`;
  }

  // Predicted landing site: marked on the terrain at the slice CENTRE (on the
  // surface). Independent of the velocity vector.
  const siteX = pad + plotW * 0.5;
  const siteHeight = profile ? profile[(profile.length - 1) >> 1] : 0;
  const siteY = profile ? baseY - siteHeight * amp : baseY;

  // Vessel: the current position, ABOVE the terrain, upwind of the site. It
  // DESCENDS down the plot as altitude drops — high near the top of the sky when
  // far up, easing onto the surface at touchdown. The vertical fraction uses
  // agl/(agl+K) so any altitude maps monotonically into the plot without needing
  // a known start-of-descent reference, and eases in near the ground.
  const vesselX = pad + plotW * 0.3;
  const topBound = topY - 6;
  // Terrain surface height directly under the vessel (its column of the slice).
  const surfAtVessel = profile
    ? baseY - profile[Math.round(0.3 * (profile.length - 1))] * amp
    : baseY;
  const AGL_SOFTNESS = 1200; // metres; larger ⇒ vessel stays high longer
  const altFrac =
    aglMeters == null
      ? 1 // no altitude ⇒ draw high (as before)
      : aglMeters <= 0
        ? 0
        : aglMeters / (aglMeters + AGL_SOFTNESS);
  const vesselY = Math.max(
    topBound,
    Math.min(
      surfAtVessel - 3,
      surfAtVessel - altFrac * (surfAtVessel - topBound),
    ),
  );
  // Accurate velocity vector: true descent angle + length ∝ speed (consistently
  // scaled). Short — it represents current motion, not a line to the site.
  const vDown = verticalSpeed != null && verticalSpeed > 0 ? verticalSpeed : 0;
  const vHor =
    horizontalSpeed != null && horizontalSpeed > 0 ? horizontalSpeed : 0;
  const speed = Math.hypot(vDown, vHor);
  const SPEED_FULLSCALE = 250;
  const velLen = speed > 0 ? Math.min(1, speed / SPEED_FULLSCALE) * 48 : 0;
  const velTipX = speed > 0 ? vesselX + (vHor / speed) * velLen : vesselX;
  const velTipY = speed > 0 ? vesselY + (vDown / speed) * velLen : vesselY;

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={label}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <title>{label}</title>
      <rect
        x={4}
        y={4}
        width={SIZE - 8}
        height={SIZE - 8}
        rx={4}
        fill="var(--color-surface-raised)"
        stroke="var(--color-border-subtle)"
      />
      {/* Soft fill beneath the terrain (no stroke) so "ground below, sky above"
          reads without drawing any perimeter or bottom line. */}
      {fillArea && (
        <polygon points={fillArea} fill="var(--color-surface-app)" />
      )}
      {/* The terrain itself: JUST the top surface line (open skyline). */}
      {topLine && (
        <polyline
          points={topLine}
          fill="none"
          stroke="var(--color-text-dim)"
          strokeWidth={1.5}
        />
      )}
      {/* Accurate velocity vector from the vessel (green, no head): true descent
          angle, length ∝ speed. It represents current motion — short, and free
          to cut off in mid-air; it is NOT a line to the site. */}
      <line
        x1={vesselX}
        y1={vesselY}
        x2={velTipX}
        y2={velTipY}
        stroke="var(--color-accent-fg)"
        strokeWidth={2.5}
      />
      {/* The vessel, above the terrain (descending). */}
      <circle
        cx={vesselX}
        cy={vesselY}
        r={3}
        fill="var(--color-text-primary)"
      />
      {/* Predicted landing site — a SEPARATE marker on the terrain profile. */}
      <SiteMarker cx={siteX} cy={siteY} />
      {/* Magnitudes. */}
      <text
        x={8}
        y={16}
        fontSize={9}
        fill="var(--color-accent-fg)"
        fontFamily="monospace"
      >
        ↓ {fmtSpeed(verticalSpeed)}
      </text>
      <text
        x={SIZE - 8}
        y={16}
        fontSize={9}
        textAnchor="end"
        fill="var(--color-accent-fg)"
        fontFamily="monospace"
      >
        → {fmtSpeed(horizontalSpeed)}
      </text>
    </svg>
  );
}
