/**
 * TouchdownReticle — the site-assessment centrepiece: a compact spatial view of
 * the spot the craft is heading for. Shows a reticle at the sampled point, a
 * downhill slope arrow (which way you tip), a drift vector (how far downrange
 * from directly below you), the biome, a roughness tint, and a SAFE / MARGINAL /
 * DIVERT hazard banner. An honest source badge says whether the terrain is the
 * PREDICTED touchdown point or a SUB-VESSEL estimate.
 *
 * This is telemetry alerting, never GO/NO-GO. Bespoke SVG (no relief yet — the
 * shaded heightmap patch arrives with B8); the panel is tinted by the roughness
 * grade, never colour-alone (the banner + labels carry the verdict in text).
 *
 * Purely presentational: the hazard verdict is derived upstream; terrain fields
 * come off `vessel.landing`.
 */

import { StatusPill } from "@ksp-gonogo/ui-kit";
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
}: Readonly<TouchdownReticleProps>) {
  const v = verdict.verdict;

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
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={reticleLabel}
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
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

        {/* Slope arrow (downhill). */}
        {slopeTip && (
          <line
            x1={C}
            y1={C}
            x2={slopeTip.x}
            y2={slopeTip.y}
            stroke="var(--color-accent-fg)"
            strokeWidth={2.5}
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

        {/* Biome label. */}
        {biome && (
          <text
            x={C}
            y={SIZE - 10}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-text-faint)"
            fontFamily="monospace"
          >
            {biome}
          </text>
        )}
      </svg>

      {/* The verdict banner — the text carrier (colour is never alone). */}
      <div role="status" aria-live="polite">
        {v ? (
          <StatusPill $tone={BANNER_TONE[v]}>{v}</StatusPill>
        ) : (
          <StatusPill $tone="default">SITE —</StatusPill>
        )}
      </div>

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
