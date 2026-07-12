import type { BodyDefinition, SCANScanningVessel } from "@ksp-gonogo/core";
import { latLonToMap } from "@ksp-gonogo/core";
import { WORLD_H, WORLD_W } from "./camera";

/**
 * World-space rendering helpers for the SCANsat MapView extension:
 * scanning-vessel ground-track footprints (B). Kept out of index.tsx so the
 * geometry is unit-testable without mounting the widget.
 *
 * The anomaly distance/bearing ranking (C) that used to live here moved to
 * `mod/GonogoScansatUplink/client/src/AnomalyOverlay` alongside the rest of
 * the anomaly display (P4c-b, Uplink invariant #5 "augment, don't embed") —
 * core MapView no longer reads `scansat.anomalies` at all, so this file has
 * nothing left to compute for it.
 */

function wrapLon180(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/**
 * Paint every scanning vessel's footprint rectangle onto the world-space
 * overlay canvas. Caller has already applied the camera transform, so we
 * draw in WORLD_W×WORLD_H coordinates.
 *
 * Extents come straight off the wire — `groundTrackWidthDeg` is the
 * per-side LATITUDE half-width (SCANsat's `getFOV` via reflection),
 * `groundTrackLonHalfDeg` is the per-side LONGITUDE half-width (the
 * fork's 1/cos widening, capped at 120°). Tint mirrors `trackColor`
 * (Color32, 0–255 components). Only vessels on `body` are drawn. The
 * body's `longitudeOffset` / `latitudeOffset` are applied so the rect
 * lines up with the rendered base map; the antimeridian wrap is split
 * into two fillRects (mirrors `tileToPixelRect`).
 */
export function drawScanningFootprints(
  ctx: CanvasRenderingContext2D,
  body: BodyDefinition,
  vessels: readonly SCANScanningVessel[],
  camZoom: number,
): void {
  const lonOff = body.longitudeOffset ?? 0;
  const latOff = body.latitudeOffset ?? 0;
  const strokeW = Math.max(0.75, 1 / camZoom);

  for (const v of vessels) {
    if (v.body !== body.name) continue;
    const halfLat = v.groundTrackWidthDeg;
    const halfLon = v.groundTrackLonHalfDeg;
    if (halfLat == null || halfLat <= 0) continue;
    if (halfLon == null || halfLon <= 0) continue;

    const tc = v.trackColor;
    const fill = tc
      ? `rgba(${tc.r}, ${tc.g}, ${tc.b}, ${(((tc.a ?? 255) / 255) * 0.45).toFixed(3)})`
      : "rgba(255, 255, 255, 0.3)";
    const stroke = tc
      ? `rgba(${tc.r}, ${tc.g}, ${tc.b}, 0.9)`
      : "rgba(255, 255, 255, 0.7)";

    // Latitude band (no wrap — clamp to the poles).
    const latTop = Math.min(90, v.subLatitude + halfLat + latOff);
    const latBot = Math.max(-90, v.subLatitude - halfLat + latOff);
    const { y: yTop } = latLonToMap(latTop, 0, WORLD_W, WORLD_H);
    const { y: yBot } = latLonToMap(latBot, 0, WORLD_W, WORLD_H);
    const rectY = Math.min(yTop, yBot);
    const rectH = Math.abs(yBot - yTop);

    // Longitude band, offset-adjusted + wrapped to [-180, 180).
    const cLon = wrapLon180(v.subLongitude + lonOff);
    const lonLo = cLon - halfLon;
    const lonHi = cLon + halfLon;
    const { x: xLoRaw } = latLonToMap(0, wrapLon180(lonLo), WORLD_W, WORLD_H);
    const { x: xHiRaw } = latLonToMap(0, wrapLon180(lonHi), WORLD_W, WORLD_H);

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeW;

    if (halfLon * 2 >= 360) {
      // Spans the whole map — single full-width rect.
      ctx.fillRect(0, rectY, WORLD_W, rectH);
      ctx.strokeRect(0, rectY, WORLD_W, rectH);
    } else if (xHiRaw > xLoRaw) {
      const rw = xHiRaw - xLoRaw;
      ctx.fillRect(xLoRaw, rectY, rw, rectH);
      ctx.strokeRect(xLoRaw, rectY, rw, rectH);
    } else {
      // Wraps the antimeridian — two slices.
      const rwRight = WORLD_W - xLoRaw;
      ctx.fillRect(xLoRaw, rectY, rwRight, rectH);
      ctx.strokeRect(xLoRaw, rectY, rwRight, rectH);
      ctx.fillRect(0, rectY, xHiRaw, rectH);
      ctx.strokeRect(0, rectY, xHiRaw, rectH);
    }
  }
}
