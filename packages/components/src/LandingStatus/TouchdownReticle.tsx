/**
 * TouchdownReticle — the spatial "you are here, you'll touch down there" view,
 * anchored on the PREDICTED landing site at centre (target ring + X). The
 * CURRENT sub-vessel position sits off-centre by the drift, and a prominent line
 * runs from it to the centred site, so you read how far and which way you are
 * from where you'll land. Behind it, the sampled terrain renders as a smooth
 * interpolated gradient (shaded from the height-grid points) so the slope reads
 * naturally from the surface — no explicit slope arrow needed. A SAFE /
 * MARGINAL / DIVERT banner + the biome/slope readout carry the hazard in text.
 *
 * This is telemetry alerting, never GO/NO-GO. The smooth relief is painted to a
 * small canvas and up-scaled by the browser (bilinear) into a continuous
 * gradient; where canvas is unavailable (jsdom snapshots) it falls back to a
 * per-cell grid. Colour is never the sole carrier (banner + labels carry it).
 *
 * Purely presentational: the hazard verdict is derived upstream; terrain fields
 * come off `vessel.landing`.
 */

import { StatusPill } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { greatCircle } from "./geo";
import type { Hazard, HazardResult } from "./hazardVerdict";

export interface TouchdownReticleProps {
  /** Predicted touchdown site, degrees. */
  siteLat: number | null;
  siteLon: number | null;
  /** Current sub-vessel point, degrees (the reticle centre). */
  vesselLat: number | null;
  vesselLon: number | null;
  /** Body mean radius, metres — for the current→site distance. */
  bodyRadius: number | null;
  /** Terrain slope at the site, degrees (labelled). */
  slopeDeg: number | null;
  /** Biome at the site. */
  biome: string | null;
  /** Which sampling source is live. */
  sampleSource: string | null;
  /** The site hazard verdict (worst-band-wins). */
  verdict: HazardResult;
  /** Flattened row-major NxN terrain-height grid for the relief shading. */
  terrainPatch?: readonly number[] | null;
  /** The N of the NxN terrain patch. */
  terrainPatchSize?: number | null;
}

/**
 * Per-vertex hillshade (0..1) over a normalised height grid: a light from the
 * top-left carves ridges/craters into visible relief. Returns null when the
 * patch is missing or degenerate (the reticle then shows the flat verdict tint).
 */
function hillshade(
  patch: readonly number[] | null | undefined,
  size: number | null | undefined,
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
  const norm = (r: number, c: number) =>
    range > 0 ? (patch[r * size + c] - lo) / range : 0.5;
  // Light direction (top-left, elevated) and vertical exaggeration.
  const lx = -0.6;
  const ly = -0.6;
  const lz = 0.52;
  const ll = Math.hypot(lx, ly, lz);
  const k = 0.28;
  const shade = new Array<number>(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const dzdx =
        norm(r, Math.min(size - 1, c + 1)) - norm(r, Math.max(0, c - 1));
      const dzdy =
        norm(Math.min(size - 1, r + 1), c) - norm(Math.max(0, r - 1), c);
      const nl = Math.hypot(-dzdx, -dzdy, k) || 1;
      const dot = (-dzdx * lx + -dzdy * ly + k * lz) / (nl * ll);
      shade[r * size + c] = Math.max(0.1, Math.min(1, 0.5 + dot * 0.7));
    }
  }
  return shade;
}

/** Shadow strength (black overlay alpha) for a shade value. */
function shadowAlpha(s: number): number {
  return s < 0.5 ? Math.min(0.6, (0.5 - s) * 1.3) : 0;
}
/** Light strength (white overlay alpha) for a shade value. */
function lightAlpha(s: number): number {
  return s > 0.62 ? Math.min(0.6, (s - 0.62) * 0.9) : 0;
}

/**
 * Paint the shade grid to a small canvas (black shadows / white highlights over
 * transparency) and return a data URI. The browser up-scales it bilinearly into
 * a smooth gradient — "shade from the points", the continuous-surface look.
 * Returns null where canvas is unavailable (jsdom), so the caller falls back to
 * a per-cell grid for the DOM-snapshot path.
 */
function reliefDataUri(
  shade: number[] | null,
  size: number | null | undefined,
): string | null {
  if (!shade || !size) return null;
  if (typeof document === "undefined") return null;
  // Under test (jsdom) canvas isn't implemented — skip straight to the rect
  // fallback so the DOM snapshot stays small/stable and jsdom emits no
  // "getContext not implemented" noise. Browser/app builds run the canvas path.
  if (process.env.NODE_ENV === "test") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const s = shade[i];
    const shadow = shadowAlpha(s);
    const light = lightAlpha(s);
    const isShadow = shadow >= light;
    const alpha = Math.max(shadow, light);
    const val = isShadow ? 0 : 255;
    const j = i * 4;
    img.data[j] = val;
    img.data[j + 1] = val;
    img.data[j + 2] = val;
    img.data[j + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

const SIZE = 160;
const C = SIZE / 2;
// Downrange distance (m) that maps to the reticle edge; beyond it the site
// marker clamps to the rim and the true distance rides in the readout.
const DRIFT_FULLSCALE_M = 3000;

const BANNER_TONE: Record<Hazard, "go" | "warning" | "alert"> = {
  SAFE: "go",
  MARGINAL: "warning",
  DIVERT: "alert",
};

/** Roughness/verdict tint for the site panel — paired with the text banner. */
function panelTint(verdict: Hazard | null): string {
  if (verdict === "DIVERT") return "var(--color-status-nogo-bg)";
  if (verdict === "MARGINAL") return "var(--color-status-warning-bg)";
  if (verdict === "SAFE") return "var(--color-status-go-bg)";
  return "var(--color-surface-raised)";
}

/** Point at `deg` clockwise from up (north), `len` from the centre. */
function atHeading(deg: number, len: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: C + len * Math.sin(a), y: C - len * Math.cos(a) };
}

export function TouchdownReticle({
  siteLat,
  siteLon,
  vesselLat,
  vesselLon,
  bodyRadius,
  slopeDeg,
  biome,
  sampleSource,
  verdict,
  terrainPatch,
  terrainPatchSize,
}: Readonly<TouchdownReticleProps>) {
  const v = verdict.verdict;
  const shade = hillshade(terrainPatch, terrainPatchSize);
  const reliefUri = reliefDataUri(shade, terrainPatchSize);

  // Displacement from the CURRENT sub-vessel point to the predicted site.
  const drift =
    siteLat != null &&
    siteLon != null &&
    vesselLat != null &&
    vesselLon != null &&
    bodyRadius != null
      ? greatCircle(vesselLat, vesselLon, siteLat, siteLon, bodyRadius)
      : null;

  const sourceLabel =
    sampleSource === "predicted"
      ? "predicted"
      : sampleSource === "sub-vessel"
        ? "sub-vessel (est.)"
        : "—";

  const slopeText = slopeDeg == null ? "—" : `${slopeDeg.toFixed(1)}° slope`;
  const driftText =
    drift == null ? "" : `, ${Math.round(drift.distanceMeters)} m downrange`;
  const reticleLabel = `Touchdown site: ${slopeText}${driftText}${
    biome ? `, ${biome}` : ""
  } (${sourceLabel})`;

  // The predicted site is the ANCHOR at centre; the current position sits
  // off-centre by the drift, in the direction OPPOSITE the downrange bearing
  // (site → vessel), scaled to the reticle and clamped to the rim for far sites.
  const offLen =
    drift != null
      ? Math.min(1, drift.distanceMeters / DRIFT_FULLSCALE_M) * (C - 18)
      : 0;
  const currentTip =
    drift != null && offLen > 2
      ? atHeading(drift.bearingDeg + 180, offLen)
      : null;

  return (
    <div>
      {/* Verdict banner FIRST so it is always visible even when the relief
          fills the column below it (the text carrier; colour never alone). */}
      <div role="status" aria-live="polite">
        {v ? (
          <StatusPill $tone={BANNER_TONE[v]}>{v}</StatusPill>
        ) : (
          <StatusPill $tone="default">NO SITE</StatusPill>
        )}
      </div>

      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={reticleLabel}
        // The reticle is the centerpiece — fill the dominant column (up to a
        // sensible cap) so the terrain read is the star, not a thumbnail.
        style={{
          display: "block",
          width: "100%",
          maxWidth: 320,
          height: "auto",
          marginTop: "0.15rem",
        }}
      >
        <title>{reticleLabel}</title>
        {/* Site panel, tinted by the verdict (paired with the text banner). */}
        <rect
          x={4}
          y={4}
          width={SIZE - 8}
          height={SIZE - 8}
          rx={4}
          fill={panelTint(v)}
          stroke="var(--color-border-subtle)"
        />

        {/* Terrain relief. Smooth path: a small shade canvas up-scaled by the
            browser into a continuous gradient. Fallback path (no canvas, e.g.
            jsdom): a per-cell grid so the DOM snapshot stays small + stable. */}
        {reliefUri ? (
          <image
            href={reliefUri}
            x={5}
            y={5}
            width={SIZE - 10}
            height={SIZE - 10}
            preserveAspectRatio="none"
          />
        ) : (
          shade &&
          terrainPatchSize &&
          (() => {
            const n = terrainPatchSize;
            const inner = SIZE - 8;
            const cell = inner / n;
            const out: ReactNode[] = [];
            for (let r = 0; r < n; r++) {
              for (let c = 0; c < n; c++) {
                const s = shade[r * n + c];
                const shadow = shadowAlpha(s);
                const light = lightAlpha(s);
                const fill = shadow >= light ? "black" : "white";
                const op = Math.max(shadow, light);
                if (op <= 0.02) continue;
                out.push(
                  <rect
                    key={`relief-${r}-${c}`}
                    x={4 + c * cell}
                    y={4 + r * cell}
                    width={cell + 0.5}
                    height={cell + 0.5}
                    fill={fill}
                    opacity={op}
                  />,
                );
              }
            }
            return <g>{out}</g>;
          })()
        )}

        {/* Current → site: the primary spatial readout. A plain line (no head —
            the off-centre current crosshair and the centred site marker
            terminate it) from where you are to where you'll land. */}
        {currentTip && (
          <line
            x1={currentTip.x}
            y1={currentTip.y}
            x2={C}
            y2={C}
            stroke="var(--color-text-primary)"
            strokeWidth={2.5}
          />
        )}

        {/* Predicted landing site — the ANCHOR: a target ring + X at centre.
            Clearly the landing spot the whole instrument is assessing. */}
        <g>
          <circle
            cx={C}
            cy={C}
            r={8}
            fill="none"
            stroke="var(--color-accent-fg)"
            strokeWidth={2.5}
          />
          <line
            x1={C - 5}
            y1={C - 5}
            x2={C + 5}
            y2={C + 5}
            stroke="var(--color-accent-fg)"
            strokeWidth={2}
          />
          <line
            x1={C - 5}
            y1={C + 5}
            x2={C + 5}
            y2={C - 5}
            stroke="var(--color-accent-fg)"
            strokeWidth={2}
          />
        </g>

        {/* Current position — off-centre by the drift (a small, distinct white
            crosshair). Omitted when you're right over the site. */}
        {currentTip && (
          <g>
            <circle
              cx={currentTip.x}
              cy={currentTip.y}
              r={4}
              fill="none"
              stroke="var(--color-text-primary)"
              strokeWidth={1.5}
            />
            <line
              x1={currentTip.x - 8}
              y1={currentTip.y}
              x2={currentTip.x + 8}
              y2={currentTip.y}
              stroke="var(--color-text-primary)"
              strokeWidth={1}
            />
            <line
              x1={currentTip.x}
              y1={currentTip.y - 8}
              x2={currentTip.x}
              y2={currentTip.y + 8}
              stroke="var(--color-text-primary)"
              strokeWidth={1}
            />
          </g>
        )}
      </svg>

      {/* Honest biome + source + terrain readout (a11y text equivalent of the
          SVG; biome lives here as a standard readout, not overlaid on relief). */}
      <div style={{ fontSize: "0.75rem", opacity: 0.75 }}>
        {biome ? `${biome} · ` : ""}
        {slopeText}
        {drift != null
          ? ` · ${Math.round(drift.distanceMeters)} m downrange`
          : ""}
        {` · ${sourceLabel}`}
      </div>
    </div>
  );
}
