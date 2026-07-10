import { useBiomeCanvas, useFogDisplayCanvas } from "@gonogo/components";
import {
  type BodyDefinition,
  type SCANScanningVessel,
  useDataValue,
} from "@gonogo/core";
import { useScanAnomalies, useScanningVessels } from "@gonogo/data";
import { useElementSize } from "@gonogo/ui";
import { useEffect, useRef } from "react";
import styled from "styled-components";

/**
 * Live "camera view" of the active vessel's sub-point. Composites the
 * real SCANsat biome canvas + fog mask, then overlays the vessel
 * crosshair and any anomalies that fall inside the window. The base
 * pixels come straight from `scan.biomeGrid[body]` and the fog comes
 * straight from `scan.maskBitmap[body, AltimetryHiRes]` — no
 * approximation, just a windowed view of what SCANsat is actually
 * producing.
 */
export interface MinimapProps {
  body: BodyDefinition;
  /** Active vessel sub-point latitude in degrees, undefined when unknown. */
  vesselLat: number | undefined;
  /** Active vessel sub-point longitude in degrees, undefined when unknown. */
  vesselLon: number | undefined;
}

/** Upper bound on the square minimap edge; shrinks to fit narrow panels. */
const MAX_MINIMAP_PX = 240;
/** Half-window in degrees of latitude. Square in lat space. */
const WINDOW_HALF_DEG = 20;
/** Source-canvas dimensions; must match useBiomeCanvas. */
const SRC_W = 2048;
const SRC_H = 1024;

export function Minimap({
  body,
  vesselLat,
  vesselLon,
}: Readonly<MinimapProps>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The minimap is square; its edge tracks the container width, capped so it
  // never overflows a narrow panel and never grows past the legible maximum.
  const { ref: wrapRef, size } = useElementSize<HTMLDivElement>({
    w: MAX_MINIMAP_PX,
    h: MAX_MINIMAP_PX,
  });
  const minimapPx = Math.max(1, Math.min(MAX_MINIMAP_PX, size.w));
  const biome = useBiomeCanvas(body, true);
  const fog = useFogDisplayCanvas(body.name);
  const anomalies = useScanAnomalies(body.name);
  const scanningVessels = useScanningVessels();

  // Repaint on body change, vessel-move, resize, or upstream-canvas mutation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: biome.version / fog.version bump on canvas-bytes-changed; the canvas reference is stable across mutations
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Reset.
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, minimapPx, minimapPx);

    if (vesselLat === undefined || vesselLon === undefined) {
      drawMissingVessel(ctx, minimapPx);
      return;
    }

    const texLat = vesselLat + (body.latitudeOffset ?? 0);
    const texLon = vesselLon + (body.longitudeOffset ?? 0);
    // Source rectangle in 360°×180° tex space, lat axis flipped (north=0).
    const srcCenterX = ((wrapLon(texLon) + 180) / 360) * SRC_W;
    const srcCenterY = ((90 - texLat) / 180) * SRC_H;
    const halfWpx = (WINDOW_HALF_DEG / 360) * SRC_W;
    const halfHpx = (WINDOW_HALF_DEG / 180) * SRC_H;
    const sx = srcCenterX - halfWpx;
    const sy = Math.max(0, Math.min(SRC_H - 2 * halfHpx, srcCenterY - halfHpx));
    const sw = 2 * halfWpx;
    const sh = 2 * halfHpx;

    if (biome.canvas) {
      drawWindowed(ctx, biome.canvas, sx, sy, sw, sh, minimapPx);
    }
    if (fog.canvas) {
      drawWindowed(ctx, fog.canvas, sx, sy, sw, sh, minimapPx);
    }

    // Scanner footprints — drawn with SCANsat's own getFOV +
    // trackColor so the minimap mirrors the in-game ground-track
    // overlay. We render every tracked vessel on this body, not just
    // the active one.
    if (scanningVessels) {
      for (const v of scanningVessels) {
        if (v.body !== body.name) continue;
        drawScannerFootprint(ctx, body, v, texLat, texLon, minimapPx);
      }
    }

    // Anomaly markers, transformed into minimap pixel space.
    if (anomalies) {
      for (const a of anomalies) {
        if (!a.known) continue;
        const aTexLat = a.latitude + (body.latitudeOffset ?? 0);
        const aTexLon = a.longitude + (body.longitudeOffset ?? 0);
        const dLat = aTexLat - texLat;
        const dLon = shortestLonDelta(wrapLon(aTexLon), wrapLon(texLon));
        if (Math.abs(dLat) > WINDOW_HALF_DEG) continue;
        if (Math.abs(dLon) > WINDOW_HALF_DEG) continue;
        const px = minimapPx / 2 + (dLon / WINDOW_HALF_DEG) * (minimapPx / 2);
        // Lat axis flips: north (positive lat) is up; minimap y=0 is top.
        const py = minimapPx / 2 - (dLat / WINDOW_HALF_DEG) * (minimapPx / 2);
        ctx.fillStyle = a.detail ? "#ffeb3b" : "rgba(255, 235, 59, 0.55)";
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Crosshair on top of everything.
    drawCrosshair(ctx, minimapPx);
  }, [
    body,
    vesselLat,
    vesselLon,
    minimapPx,
    biome.canvas,
    biome.version,
    fog.canvas,
    fog.version,
    anomalies,
    scanningVessels,
  ]);

  return (
    <MinimapRoot ref={wrapRef}>
      <MinimapCanvas
        ref={canvasRef}
        width={minimapPx}
        height={minimapPx}
        aria-label={`Live scan view centred on ${body.name}`}
      />
      <MinimapLabel>
        <strong>{body.name}</strong>
        {vesselLat !== undefined && vesselLon !== undefined ? (
          <span>
            {vesselLat.toFixed(2)}°, {vesselLon.toFixed(2)}°
          </span>
        ) : (
          <span>—</span>
        )}
      </MinimapLabel>
    </MinimapRoot>
  );
}

/**
 * Container Scanning widget pulls the active vessel sub-point from
 * telemetry. Splitting it out lets the Minimap take only what it
 * needs and keeps the data hooks colocated with the widget that owns
 * them.
 */
export function MinimapForActiveVessel({
  body,
}: Readonly<{ body: BodyDefinition }>) {
  const lat = useDataValue<number>("data", "v.lat");
  const lon = useDataValue<number>("data", "v.long");
  return <Minimap body={body} vesselLat={lat} vesselLon={lon} />;
}

function drawWindowed(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  px: number,
): void {
  // Horizontal wrap on antimeridian: emit two slices.
  if (sx < 0) {
    const left = -sx;
    ctx.drawImage(
      source,
      SRC_W - left,
      sy,
      left,
      sh,
      0,
      0,
      (left / sw) * px,
      px,
    );
    ctx.drawImage(
      source,
      0,
      sy,
      sw - left,
      sh,
      (left / sw) * px,
      0,
      ((sw - left) / sw) * px,
      px,
    );
    return;
  }
  if (sx + sw > SRC_W) {
    const right = SRC_W - sx;
    ctx.drawImage(source, sx, sy, right, sh, 0, 0, (right / sw) * px, px);
    ctx.drawImage(
      source,
      0,
      sy,
      sw - right,
      sh,
      (right / sw) * px,
      0,
      ((sw - right) / sw) * px,
      px,
    );
    return;
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, px, px);
}

/**
 * Paint a single scanning vessel's footprint rectangle. The lat/lon
 * extents come straight off the wire — `groundTrackWidthDeg` (from
 * SCANsat's private `getFOV` via reflection) for latitude, and
 * `groundTrackLonHalfDeg` (the fork-side 1/cos widening with the 120°
 * cap that SCANsat itself uses) for longitude. The tint mirrors
 * `SCANvessel.trackColor`. No formula here — only projection of the
 * SCANsat-supplied rect into the minimap's window.
 */
function drawScannerFootprint(
  ctx: CanvasRenderingContext2D,
  body: BodyDefinition,
  v: SCANScanningVessel,
  centerTexLat: number,
  centerTexLon: number,
  px: number,
): void {
  const halfLat = v.groundTrackWidthDeg;
  const halfLon = v.groundTrackLonHalfDeg;
  if (halfLat == null || halfLat <= 0) return;
  if (halfLon == null || halfLon <= 0) return;

  const tc = v.trackColor;
  const fill = tc
    ? `rgba(${tc.r}, ${tc.g}, ${tc.b}, ${(tc.a / 255).toFixed(3)})`
    : "rgba(255, 255, 255, 0.4)";

  const vTexLat = v.subLatitude + (body.latitudeOffset ?? 0);
  const vTexLon = wrapLon(v.subLongitude + (body.longitudeOffset ?? 0));
  // Vertical extent — straight delta-lat from the minimap centre.
  const dLatTop = vTexLat + halfLat - centerTexLat;
  const dLatBot = vTexLat - halfLat - centerTexLat;
  if (dLatTop < -WINDOW_HALF_DEG && dLatBot < -WINDOW_HALF_DEG) return;
  if (dLatTop > WINDOW_HALF_DEG && dLatBot > WINDOW_HALF_DEG) return;
  const yTop =
    px / 2 -
    (clamp(dLatTop, -WINDOW_HALF_DEG, WINDOW_HALF_DEG) / WINDOW_HALF_DEG) *
      (px / 2);
  const yBot =
    px / 2 -
    (clamp(dLatBot, -WINDOW_HALF_DEG, WINDOW_HALF_DEG) / WINDOW_HALF_DEG) *
      (px / 2);

  // Horizontal extent — shortest delta-lon from the minimap centre.
  const dLon = shortestLonDelta(vTexLon, centerTexLon);
  const dLonLeft = dLon - halfLon;
  const dLonRight = dLon + halfLon;
  if (dLonLeft > WINDOW_HALF_DEG && dLonRight > WINDOW_HALF_DEG) return;
  if (dLonLeft < -WINDOW_HALF_DEG && dLonRight < -WINDOW_HALF_DEG) return;
  const xLeft =
    px / 2 +
    (clamp(dLonLeft, -WINDOW_HALF_DEG, WINDOW_HALF_DEG) / WINDOW_HALF_DEG) *
      (px / 2);
  const xRight =
    px / 2 +
    (clamp(dLonRight, -WINDOW_HALF_DEG, WINDOW_HALF_DEG) / WINDOW_HALF_DEG) *
      (px / 2);

  ctx.fillStyle = fill;
  ctx.fillRect(xLeft, yTop, xRight - xLeft, yBot - yTop);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function drawCrosshair(ctx: CanvasRenderingContext2D, px: number): void {
  const c = px / 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c - 8, c);
  ctx.lineTo(c + 8, c);
  ctx.moveTo(c, c - 8);
  ctx.lineTo(c, c + 8);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0, 255, 136, 0.85)";
  ctx.beginPath();
  ctx.arc(c, c, 5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawMissingVessel(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("no active vessel", px / 2, px / 2);
}

function wrapLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

function shortestLonDelta(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

const MinimapRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: ${MAX_MINIMAP_PX}px;
`;

const MinimapCanvas = styled.canvas`
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  image-rendering: pixelated;
`;

const MinimapLabel = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  strong {
    color: var(--color-text-primary);
    font-weight: 600;
  }
`;
