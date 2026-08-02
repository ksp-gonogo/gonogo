/**
 * TouchdownReticle: the spatial "you are here, you'll touch down there" view,
 * anchored on the PREDICTED landing site at centre (target ring + X). The
 * CURRENT sub-vessel position sits off-centre by the drift, and a prominent line
 * runs from it to the centred site, so you read how far and which way you are
 * from where you'll land. Behind it, the sampled terrain renders as DIRECT
 * altimetry: a hypsometric colour ramp (colour = altitude) with contour
 * iso-lines at the band edges, so slope/shape read precisely (close contours =
 * steep, a bullseye = a crater/peak). This is a bare square SVG: the widget
 * composes the SAFE / MARGINAL / DIVERT banner + the biome/slope readout below
 * it (so the two altimetry plots align), and the verdict rides that banner (the
 * reticle box itself is borderless, the tint read as noise).
 *
 * This is telemetry alerting, never GO/NO-GO. The relief is painted to a small
 * canvas + up-scaled by the browser; where canvas is unavailable (jsdom
 * snapshots) it falls back to a per-cell banded grid. The terrain palette is
 * neutral; colour is never the sole verdict carrier (the widget's banner is).
 *
 * Purely presentational: the hazard verdict is derived upstream; terrain fields
 * come off `vessel.landing`.
 */

import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useId } from "react";
import { greatCircle } from "./geo";
import { SiteMarker } from "./SiteMarker";

export interface TouchdownReticleProps {
  /** Predicted touchdown site, degrees. */
  siteLat: number | null;
  siteLon: number | null;
  /** Current sub-vessel point, degrees (the reticle centre). */
  vesselLat: number | null;
  vesselLon: number | null;
  /** Body mean radius, metres, for the current→site distance. */
  bodyRadius: number | null;
  /** Terrain slope at the site, degrees (labelled). */
  slopeDeg: number | null;
  /** Biome at the site. */
  biome: string | null;
  /** Which sampling source is live. */
  sampleSource: string | null;
  /** Flattened row-major NxN terrain-height grid for the relief shading. */
  terrainPatch?: readonly number[] | null;
  /** The N of the NxN terrain patch. */
  terrainPatchSize?: number | null;
  /** Spatial full-scale (metres to the reticle edge), SLIDING: zooms in as the
   * approach closes. Defaults to the fixed 3 km scale when not provided. */
  spanMeters?: number | null;
  /** Radius (metres) of the landing ZONE: the circle of possible touchdown
   * around the predicted point (a derived dispersion, not a pinpoint). */
  zoneRadiusMeters?: number | null;
}

/**
 * Normalise the height grid to 0..1 (and report the raw metre range for the
 * relief-scale cue). Returns null when the patch is missing or degenerate (the
 * reticle then shows the flat neutral panel). This is the altimetry input, no
 * lighting model; colour encodes height directly downstream.
 */
function normHeights(
  patch: readonly number[] | null | undefined,
  size: number | null | undefined,
): { norm: number[]; rangeMeters: number } | null {
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
  return { norm, rangeMeters: range };
}

// Elevation bands + a neutral hypsometric ramp (low → high). Colour IS altitude;
// the boundaries between bands are the iso-height contour lines (close together
// = steep, a bullseye = a crater/peak). No simulated light anywhere.
const HYPSO_BANDS = 6;
// Dimmed, desaturated low→high ramp: a low-key "tech" elevation palette. The
// high band is a muted grey, not a harsh cream/white.
const HYPSO: Array<[number, [number, number, number]]> = [
  [0.0, [26, 32, 40]],
  [0.35, [36, 52, 56]],
  [0.6, [58, 70, 66]],
  [0.8, [90, 90, 74]],
  [1.0, [132, 130, 116]],
];

function hypso(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HYPSO.length; i++) {
    if (x <= HYPSO[i][0]) {
      const [t0, c0] = HYPSO[i - 1];
      const [t1, c1] = HYPSO[i];
      const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return HYPSO[HYPSO.length - 1][1];
}

/** Colour for a discrete elevation band (0..HYPSO_BANDS-1). */
function bandColour(band: number): string {
  const [r, g, b] = hypso(band / (HYPSO_BANDS - 1));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Bilinear sample of the normalised height grid at continuous (cx,cy). */
function sampleNorm(
  norm: number[],
  size: number,
  cx: number,
  cy: number,
): number {
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const a = norm[y0 * size + x0];
  const b = norm[y0 * size + x1];
  const c = norm[y1 * size + x0];
  const d = norm[y1 * size + x1];
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/**
 * Render the height grid DIRECTLY as altimetry: bilinear-upsample the normalised
 * heights, quantise into elevation bands (hypsometric colour = altitude), and
 * darken the band boundaries into contour iso-lines. No lighting model. Returns
 * a data URI, or null where canvas is unavailable (jsdom) so the caller falls
 * back to a per-cell banded grid for the DOM-snapshot path.
 */
function reliefDataUri(
  norm: number[] | null,
  size: number | null,
): string | null {
  if (!norm || !size) return null;
  if (typeof document === "undefined") return null;
  // Under test (jsdom) canvas isn't implemented: skip to the rect fallback so
  // the DOM snapshot stays small/stable and jsdom emits no "getContext" noise.
  if (process.env.NODE_ENV === "test") return null;
  const F = 72;
  const canvas = document.createElement("canvas");
  canvas.width = F;
  canvas.height = F;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const bandF = new Int16Array(F * F);
  for (let fy = 0; fy < F; fy++) {
    for (let fx = 0; fx < F; fx++) {
      const h = sampleNorm(
        norm,
        size,
        (fx / (F - 1)) * (size - 1),
        (fy / (F - 1)) * (size - 1),
      );
      bandF[fy * F + fx] = Math.max(
        0,
        Math.min(HYPSO_BANDS - 1, Math.floor(h * HYPSO_BANDS)),
      );
    }
  }
  const img = ctx.createImageData(F, F);
  for (let fy = 0; fy < F; fy++) {
    for (let fx = 0; fx < F; fx++) {
      const band = bandF[fy * F + fx];
      const [r, g, b] = hypso(band / (HYPSO_BANDS - 1));
      // Contour iso-line: darken where the band steps up/down vs a neighbour.
      const left = fx > 0 ? bandF[fy * F + fx - 1] : band;
      const up = fy > 0 ? bandF[(fy - 1) * F + fx] : band;
      const edge = left !== band || up !== band ? 0.5 : 1;
      const j = (fy * F + fx) * 4;
      img.data[j] = Math.round(r * edge);
      img.data[j + 1] = Math.round(g * edge);
      img.data[j + 2] = Math.round(b * edge);
      img.data[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

const SIZE = 160;
// In viewBox units, so it scales with the rendered plot. Matches CrossSection's
// own clip radius so the paired squares round identically at every tile size.
const RELIEF_RADIUS = 4;
const C = SIZE / 2;
// Downrange distance (m) that maps to the reticle edge; beyond it the site
// marker clamps to the rim and the true distance rides in the readout.
const DRIFT_FULLSCALE_M = 3000;

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
  terrainPatch,
  terrainPatchSize,
  spanMeters,
  zoneRadiusMeters,
}: Readonly<TouchdownReticleProps>) {
  // Unique per instance: two reticles on one screen must not share a clip id.
  const reliefClipId = useId();
  // Sliding spatial scale (metres to the rim); falls back to the fixed default.
  const span =
    spanMeters != null && spanMeters > 0 ? spanMeters : DRIFT_FULLSCALE_M;
  const heights = normHeights(terrainPatch, terrainPatchSize);
  const reliefUri = reliefDataUri(
    heights?.norm ?? null,
    terrainPatchSize ?? null,
  );

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
        : NULL_DISPLAY;

  const slopeText =
    slopeDeg == null ? NULL_DISPLAY : `${slopeDeg.toFixed(1)}° slope`;
  const driftText =
    drift == null ? "" : `, ${Math.round(drift.distanceMeters)} m downrange`;
  const reticleLabel = `Touchdown site: ${slopeText}${driftText}${
    biome ? `, ${biome}` : ""
  } (${sourceLabel})`;

  // The predicted site is the ANCHOR at centre; the current position sits
  // off-centre by the drift, in the direction OPPOSITE the downrange bearing
  // (site → vessel), scaled to the reticle and clamped to the rim for far sites.
  const offLen =
    drift != null ? Math.min(1, drift.distanceMeters / span) * (C - 18) : 0;

  // The landing ZONE: a ring of possible touchdown around the centred site,
  // radius mapped through the same sliding scale (clamped so it stays legible
  // inside the box). A dispersion cue, not a pinpoint.
  const zonePx =
    zoneRadiusMeters != null && zoneRadiusMeters > 0
      ? Math.max(4, Math.min(C - 8, (zoneRadiusMeters / span) * (C - 18)))
      : null;
  const currentTip =
    drift != null && offLen > 2
      ? atHeading(drift.bearingDeg + 180, offLen)
      : null;

  // svg-only: the verdict banner + biome/terrain readout are composed by the
  // widget (below the plots) so this square aligns with the cross-section plot.
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={reticleLabel}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <title>{reticleLabel}</title>
      {/* Neutral, BORDERLESS site panel. The verdict is carried by the widget's
            text banner below; a verdict-tinted box border read as inconsistent
            noise, so it's gone (the grey relief stays legible either way). */}
      {/* The surface and the border come from the enclosing FramedDisplay now.
          The corner rounding does NOT: a CSS radius on the frame is a literal
          pixel value, while this one is in viewBox units and therefore scales
          with the plot, which is the whole reason the original read as rounded
          at tile size and a 3px frame radius did not. So the relief keeps its
          own clip, and the frame keeps its own edge, matching CrossSection. */}
      <defs>
        <clipPath id={reliefClipId}>
          {/* Matches the relief image's own box (it draws inset by 5), so the
              clip actually bites its corners rather than sitting outside them. */}
          <rect
            x={5}
            y={5}
            width={SIZE - 10}
            height={SIZE - 10}
            rx={RELIEF_RADIUS}
          />
        </clipPath>
      </defs>

      <g clipPath={`url(#${reliefClipId})`}>
        {/* Terrain = direct altimetry. Smooth path: hypsometric bands + contour
            iso-lines painted to a canvas + up-scaled. Fallback (no canvas, e.g.
            jsdom): a per-cell banded grid so the DOM snapshot stays small. */}
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
          heights &&
          terrainPatchSize &&
          (() => {
            const n = terrainPatchSize;
            const inner = SIZE - 8;
            const cell = inner / n;
            const out: ReactNode[] = [];
            for (let r = 0; r < n; r++) {
              for (let c = 0; c < n; c++) {
                const band = Math.max(
                  0,
                  Math.min(
                    HYPSO_BANDS - 1,
                    Math.floor(heights.norm[r * n + c] * HYPSO_BANDS),
                  ),
                );
                out.push(
                  <rect
                    key={`relief-${r}-${c}`}
                    x={4 + c * cell}
                    y={4 + r * cell}
                    width={cell + 0.5}
                    height={cell + 0.5}
                    fill={bandColour(band)}
                  />,
                );
              }
            }
            return <g>{out}</g>;
          })()
        )}

        {/* Vertex dots: one per height-grid point, radius (and brightness)
            scaled by altitude, over the dimmed contour base. The dot field IS
            the terrain read; higher points read as larger, brighter dots. */}
        {heights &&
          terrainPatchSize &&
          (() => {
            const n = terrainPatchSize;
            const inner = SIZE - 10;
            const cell = inner / n;
            const dots: ReactNode[] = [];
            for (let r = 0; r < n; r++) {
              for (let c = 0; c < n; c++) {
                const h = heights.norm[r * n + c];
                dots.push(
                  <circle
                    key={`dot-${r}-${c}`}
                    cx={5 + (c + 0.5) * cell}
                    cy={5 + (r + 0.5) * cell}
                    r={0.3 + h * 1.1}
                    fill="var(--color-text-primary)"
                    opacity={0.28 + h * 0.42}
                  />,
                );
              }
            }
            return <g>{dots}</g>;
          })()}

        {/* Current → site: the primary spatial readout. A plain line (no head,
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

        {/* Landing ZONE: the circle of possible touchdown around the predicted
            point (drift + drag dispersion). A translucent fill + dashed rim so it
            reads as an area, not a hard edge; the site marker sits on top. */}
        {zonePx != null && (
          <circle
            cx={C}
            cy={C}
            r={zonePx}
            fill="var(--color-accent-fg)"
            fillOpacity={0.08}
            stroke="var(--color-accent-fg)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.6}
          />
        )}

        {/* Predicted landing site (the ANCHOR): the shared target marker (same as
            the side-on plot) so it clearly reads as "you'll land HERE". */}
        <SiteMarker cx={C} cy={C} />

        {/* Current position: off-centre by the drift (a small, distinct white
            dot). Omitted when you're right over the site. */}
        {currentTip && (
          <circle
            cx={currentTip.x}
            cy={currentTip.y}
            r={3.5}
            fill="none"
            stroke="var(--color-text-primary)"
            strokeWidth={1.5}
          />
        )}
      </g>
    </svg>
  );
}
