/**
 * TouchdownReticle — the site-assessment centrepiece: a compact spatial view of
 * the spot the craft is heading for. Shows a reticle at the sampled point, a
 * downhill slope arrow (which way you tip), a drift vector (how far downrange
 * from directly below you), the biome, a roughness tint, and a SAFE / MARGINAL /
 * DIVERT hazard banner. An honest source badge says whether the terrain is the
 * PREDICTED touchdown point or a SUB-VESSEL estimate.
 *
 * This is telemetry alerting, never GO/NO-GO. Bespoke SVG: when a terrain patch
 * is present it renders a hillshaded relief (terrain shape) over the verdict
 * tint, else a flat tint; colour is never the sole carrier (the banner + labels
 * carry the verdict in text).
 *
 * Purely presentational: the hazard verdict is derived upstream; terrain fields
 * come off `vessel.landing`.
 */

import { StatusPill } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { DirectionArrow } from "./DirectionArrow";
import { greatCircle } from "./geo";
import type { Hazard, HazardResult } from "./hazardVerdict";

export interface TouchdownReticleProps {
  /** Sampled point (predicted touchdown or sub-vessel), degrees. */
  siteLat: number | null;
  siteLon: number | null;
  /** Current sub-vessel point, degrees — for the drift vector. */
  vesselLat: number | null;
  vesselLon: number | null;
  /** Body mean radius, metres — for the drift distance. */
  bodyRadius: number | null;
  /** Terrain slope at the site, degrees. */
  slopeDeg: number | null;
  /** Downhill heading, degrees clockwise from north. */
  slopeHeadingDeg: number | null;
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
 * Per-cell hillshade (0..1) over a normalised height grid: a light from the
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

const SIZE = 160;
const C = SIZE / 2;

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

/** Point at heading (deg cw from north/up) and length from the centre. */
function atHeading(
  headingDeg: number,
  length: number,
): { x: number; y: number } {
  const a = (headingDeg * Math.PI) / 180;
  return { x: C + length * Math.sin(a), y: C - length * Math.cos(a) };
}

export function TouchdownReticle({
  siteLat,
  siteLon,
  vesselLat,
  vesselLon,
  bodyRadius,
  slopeDeg,
  slopeHeadingDeg,
  biome,
  sampleSource,
  verdict,
  terrainPatch,
  terrainPatchSize,
}: Readonly<TouchdownReticleProps>) {
  const v = verdict.verdict;
  const relief = hillshade(terrainPatch, terrainPatchSize);

  // Drift from directly-below to the sampled site (downrange displacement).
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

  // Slope arrow: from centre toward downhill, length grows with slope (capped).
  const slopeLen = slopeDeg != null ? Math.min(1, slopeDeg / 30) * (C - 14) : 0;
  const slopeTip =
    slopeHeadingDeg != null && slopeLen > 0
      ? atHeading(slopeHeadingDeg, slopeLen)
      : null;

  // Drift arrow: direction = bearing to site, length grows with distance (capped).
  const driftLen =
    drift != null ? Math.min(1, drift.distanceMeters / 2000) * (C - 20) : 0;
  const driftTip =
    drift != null && driftLen > 1
      ? atHeading(drift.bearingDeg, driftLen)
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

        {/* Terrain relief — a hillshaded heightmap over the verdict-tinted
            panel (shadows carved black, lit slopes lifted white), so the site's
            shape reads. Falls back to the flat tint above when no patch. */}
        {relief &&
          terrainPatchSize &&
          (() => {
            const n = terrainPatchSize;
            const inner = SIZE - 8;
            const cell = inner / n;
            const out: ReactNode[] = [];
            for (let r = 0; r < n; r++) {
              for (let c = 0; c < n; c++) {
                const s = relief[r * n + c];
                const shadow = s < 0.5 ? (0.5 - s) * 1.3 : 0;
                const light = s > 0.62 ? (s - 0.62) * 0.9 : 0;
                const fill = shadow > light ? "black" : "white";
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
                    opacity={Math.min(0.6, op)}
                  />,
                );
              }
            }
            return <g>{out}</g>;
          })()}

        {/* Drift vector (from directly-below toward the site). */}
        {driftTip && (
          <line
            x1={C}
            y1={C}
            x2={driftTip.x}
            y2={driftTip.y}
            stroke="var(--color-text-faint)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}

        {/* Slope arrow (downhill) — the shared DirectionArrow glyph, same as
            the velocity vector's resultant, oriented to the terrain gradient. */}
        {slopeTip && (
          <DirectionArrow
            x1={C}
            y1={C}
            x2={slopeTip.x}
            y2={slopeTip.y}
            color="var(--color-accent-fg)"
          />
        )}

        {/* Reticle crosshair at the sampled point (centre). */}
        <circle
          cx={C}
          cy={C}
          r={9}
          fill="none"
          stroke="var(--color-text-primary)"
          strokeWidth={1.5}
        />
        <line
          x1={C - 13}
          y1={C}
          x2={C + 13}
          y2={C}
          stroke="var(--color-text-primary)"
          strokeWidth={1}
        />
        <line
          x1={C}
          y1={C - 13}
          x2={C}
          y2={C + 13}
          stroke="var(--color-text-primary)"
          strokeWidth={1}
        />

        {/* Biome label — pinned to the TOP of the terrain (always visible even
            when the reticle runs to the fold), on a translucent dark backing
            chip plus a stroke halo so it reads over any hillshade shading. */}
        {biome && (
          <g>
            <rect
              x={C - (biome.length * 6.6 + 10) / 2}
              y={7}
              width={biome.length * 6.6 + 10}
              height={17}
              rx={3}
              fill="black"
              opacity={0.5}
            />
            <text
              x={C}
              y={19}
              textAnchor="middle"
              fontSize={11}
              fontWeight="bold"
              fill="var(--color-text-primary)"
              stroke="black"
              strokeWidth={3}
              paintOrder="stroke"
              fontFamily="monospace"
            >
              {biome}
            </text>
          </g>
        )}
      </svg>

      {/* Honest source + terrain readout (a11y text equivalent of the SVG). */}
      <div style={{ fontSize: "0.75rem", opacity: 0.75 }}>
        {slopeText}
        {drift != null
          ? ` · ${Math.round(drift.distanceMeters)} m downrange`
          : ""}
        {` · ${sourceLabel}`}
      </div>
    </div>
  );
}
