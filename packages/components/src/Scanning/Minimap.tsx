import { type BodyDefinition, useDataValue } from "@gonogo/core";
import { useScanAnomalies } from "@gonogo/data";
import { useEffect, useRef } from "react";
import styled from "styled-components";
import { useFogDisplayCanvas } from "../MapView/useFogMask";
import { useBiomeCanvas } from "../MapView/useScanLayerCanvas";

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

const MINIMAP_PX = 240;
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
  const biome = useBiomeCanvas(body, true);
  const fog = useFogDisplayCanvas(body.name);
  const anomalies = useScanAnomalies(body.name);

  // Repaint on body change, vessel-move, or upstream-canvas mutation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: biome.version / fog.version bump on canvas-bytes-changed; the canvas reference is stable across mutations
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Reset.
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);

    if (vesselLat === undefined || vesselLon === undefined) {
      drawMissingVessel(ctx);
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
      drawWindowed(ctx, biome.canvas, sx, sy, sw, sh);
    }
    if (fog.canvas) {
      drawWindowed(ctx, fog.canvas, sx, sy, sw, sh);
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
        const px = MINIMAP_PX / 2 + (dLon / WINDOW_HALF_DEG) * (MINIMAP_PX / 2);
        // Lat axis flips: north (positive lat) is up; minimap y=0 is top.
        const py = MINIMAP_PX / 2 - (dLat / WINDOW_HALF_DEG) * (MINIMAP_PX / 2);
        ctx.fillStyle = a.detail ? "#ffeb3b" : "rgba(255, 235, 59, 0.55)";
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Crosshair on top of everything.
    drawCrosshair(ctx);
  }, [
    body,
    vesselLat,
    vesselLon,
    biome.canvas,
    biome.version,
    fog.canvas,
    fog.version,
    anomalies,
  ]);

  return (
    <MinimapRoot>
      <MinimapCanvas
        ref={canvasRef}
        width={MINIMAP_PX}
        height={MINIMAP_PX}
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
      (left / sw) * MINIMAP_PX,
      MINIMAP_PX,
    );
    ctx.drawImage(
      source,
      0,
      sy,
      sw - left,
      sh,
      (left / sw) * MINIMAP_PX,
      0,
      ((sw - left) / sw) * MINIMAP_PX,
      MINIMAP_PX,
    );
    return;
  }
  if (sx + sw > SRC_W) {
    const right = SRC_W - sx;
    ctx.drawImage(
      source,
      sx,
      sy,
      right,
      sh,
      0,
      0,
      (right / sw) * MINIMAP_PX,
      MINIMAP_PX,
    );
    ctx.drawImage(
      source,
      0,
      sy,
      sw - right,
      sh,
      (right / sw) * MINIMAP_PX,
      0,
      ((sw - right) / sw) * MINIMAP_PX,
      MINIMAP_PX,
    );
    return;
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, MINIMAP_PX, MINIMAP_PX);
}

function drawCrosshair(ctx: CanvasRenderingContext2D): void {
  const c = MINIMAP_PX / 2;
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

function drawMissingVessel(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("no active vessel", MINIMAP_PX / 2, MINIMAP_PX / 2);
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
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
`;

const MinimapCanvas = styled.canvas`
  width: ${MINIMAP_PX}px;
  height: ${MINIMAP_PX}px;
  background: #0a0a0a;
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
