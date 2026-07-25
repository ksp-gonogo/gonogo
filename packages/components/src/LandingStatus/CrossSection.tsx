/**
 * CrossSection — the SIDE-ON altimetry plot, paired with the top-down reticle.
 * It slices the terrain patch ALONG THE GROUND TRACK (the horizontal-velocity
 * bearing) through the site and draws that height profile as a vertical terrain
 * cross-section. The predicted landing site is marked on the terrain profile
 * (the shared target marker), and the TRAJECTORY is drawn as a line from the
 * current position DOWN to that marked point at the descent angle — reaching the
 * terrain, never a mid-air stub — so its slope against the profile reads whether
 * the path clears the ridge ahead or drives into it. Speeds ride the ↓/→ labels.
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
}: Readonly<CrossSectionProps>) {
  const profile = sliceProfile(patch, patchSize, bearingDeg);
  const label = `Descent ${fmtSpeed(verticalSpeed)}, ground speed ${fmtSpeed(
    horizontalSpeed,
  )}`;

  const pad = 8;
  const plotW = SIZE - pad * 2;
  const baseY = SIZE - 16;
  const topY = 30;
  const amp = (baseY - topY) * 0.7;

  // Terrain silhouette polygon (profile heights + the two bottom corners).
  let silhouette = "";
  if (profile) {
    const pts = profile.map((h, i) => {
      const x = pad + plotW * (i / (profile.length - 1));
      const y = baseY - h * amp;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    silhouette = `${pad},${baseY} ${pts.join(" ")} ${pad + plotW},${baseY}`;
  }

  // Landing point: the site at the slice CENTRE, on the terrain surface.
  const siteX = pad + plotW * 0.5;
  const siteHeight = profile ? profile[(profile.length - 1) >> 1] : 0;
  const siteY = profile ? baseY - siteHeight * amp : baseY;

  // Trajectory: a straight line at the descent angle (down-right) from the craft
  // DOWN to the marked site, reaching the terrain. Back-project up the approach
  // from the site until it exits the plot top (or the left edge) — the craft.
  const vDown = verticalSpeed != null && verticalSpeed > 0 ? verticalSpeed : 0;
  const vHor =
    horizontalSpeed != null && horizontalSpeed > 0 ? horizontalSpeed : 0;
  let craftX: number;
  let craftY: number;
  if (vHor <= 0.001) {
    craftX = siteX;
    craftY = topY;
  } else {
    const m = vDown / vHor; // dy/dx, down-right (descent angle)
    const yAtLeft = siteY - m * (siteX - pad);
    if (yAtLeft >= topY) {
      craftX = pad;
      craftY = yAtLeft;
    } else {
      craftX = siteX - (siteY - topY) / m;
      craftY = topY;
    }
  }

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
      {/* Terrain cross-section silhouette (neutral fill). */}
      {silhouette && (
        <polygon
          points={silhouette}
          fill="var(--color-surface-app)"
          stroke="var(--color-text-dim)"
          strokeWidth={1.5}
        />
      )}
      {/* Ground track baseline. */}
      <line
        x1={pad}
        y1={baseY}
        x2={pad + plotW}
        y2={baseY}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      {/* Trajectory: current position DOWN to the marked site, at the descent
          angle, reaching the terrain (green, no head). */}
      <line
        x1={craftX}
        y1={craftY}
        x2={siteX}
        y2={siteY}
        stroke="var(--color-accent-fg)"
        strokeWidth={2.5}
      />
      {/* Current position — the craft at the trajectory's origin. */}
      <circle cx={craftX} cy={craftY} r={3} fill="var(--color-text-primary)" />
      {/* Predicted landing site marked on the terrain profile. */}
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
