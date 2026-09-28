import { latLonToMap } from "@ksp-gonogo/core";
import type { TrackSample } from "@ksp-gonogo/sitrep-client";
import type { EncounterKind } from "../shared/encounterKind";
import { type Camera, cameraTransform, WORLD_H, WORLD_W } from "./camera";
import {
  type BaseSurfaceLayer,
  baseSurfacePainted,
  paintBaseSurface,
} from "./paintBaseSurface";

/** Projects lat/lon (degrees) onto a canvas of the given size, per-body offset included. */
export type MapProjection = (
  w: number,
  h: number,
  lat: number,
  lon: number,
) => { x: number; y: number };

/**
 * Resolve a CSS custom property to a concrete colour for a `<canvas>` 2D
 * context, which cannot resolve `var(--...)` and paints black when handed one.
 */
export function canvasColor(
  el: HTMLElement,
  varName: string,
  fallback: string,
): string {
  const v = getComputedStyle(el).getPropertyValue(varName).trim();
  return v || fallback;
}

/** Sizes a canvas to the container and returns its 2D context, or `null` where the platform has none. */
export function sizedContext(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
): CanvasRenderingContext2D | null {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return canvas.getContext("2d");
}

/**
 * The base surface: panel fill, the composited texture and layers, then the
 * graticule. Leaves the context in screen space.
 */
export function paintMapBase(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  {
    w,
    h,
    camera,
    textureImage,
    bodyColor,
    suppressVanilla,
    layers,
  }: Readonly<{
    w: number;
    h: number;
    camera: Camera;
    textureImage: HTMLImageElement | null;
    bodyColor: string | undefined;
    suppressVanilla: boolean;
    layers: readonly BaseSurfaceLayer[];
  }>,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = canvasColor(canvas, "--color-surface-panel", "#0d0d0d");
  ctx.fillRect(0, 0, w, h);

  ctx.setTransform(...cameraTransform(camera, w, h));

  paintBaseSurface(ctx, {
    textureImage,
    bodyColor,
    suppressVanilla,
    layers,
    worldW: WORLD_W,
    worldH: WORLD_H,
  });

  // lineWidth compensates for zoom so grid lines stay 1 screen pixel. Keyed off paintBaseSurface's own predicate so it cannot disagree with what was painted.
  const surfacePainted = baseSurfacePainted({
    textureImage,
    bodyColor,
    suppressVanilla,
    layers,
  });
  ctx.strokeStyle = surfacePainted
    ? "rgba(255,255,255,0.05)"
    : canvasColor(canvas, "--color-surface-raised", "#1a1a1a");
  ctx.lineWidth = 1 / camera.zoom;
  for (let lat30 = -60; lat30 <= 60; lat30 += 30) {
    const { y } = latLonToMap(lat30, 0, WORLD_W, WORLD_H);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_W, y);
    ctx.stroke();
  }
  for (let lon30 = -150; lon30 <= 180; lon30 += 30) {
    const { x } = latLonToMap(0, lon30, WORLD_W, WORLD_H);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_H);
    ctx.stroke();
  }

  ctx.strokeStyle = surfacePainted
    ? "rgba(255,255,255,0.15)"
    : canvasColor(canvas, "--color-border-subtle", "#2a2a2a");
  ctx.lineWidth = 1.5 / camera.zoom;
  const { y: eqY } = latLonToMap(0, 0, WORLD_W, WORLD_H);
  ctx.beginPath();
  ctx.moveTo(0, eqY);
  ctx.lineTo(WORLD_W, eqY);
  ctx.stroke();
  const { x: pmX } = latLonToMap(0, 0, WORLD_W, WORLD_H);
  ctx.beginPath();
  ctx.moveTo(pmX, 0);
  ctx.lineTo(pmX, WORLD_H);
  ctx.stroke();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Stroke longitude-wrap-split segments with one fade continuous across the
 * whole list. Caller owns transform, lineWidth and dash.
 */
function drawFadedSegments(
  ctx: CanvasRenderingContext2D,
  segments: readonly TrackSample[][],
  toMap: MapProjection,
  rgb: readonly [number, number, number],
): void {
  const total = segments.reduce((sum, seg) => sum + seg.length, 0);
  if (total === 0) return;
  const [r, g, b] = rgb;
  let globalIndex = 0;
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      const prev = segment[i - 1];
      const curr = segment[i];
      const { x: x0, y: y0 } = toMap(WORLD_W, WORLD_H, prev.lat, prev.lon);
      const { x: x1, y: y1 } = toMap(WORLD_W, WORLD_H, curr.lat, curr.lon);
      const t = (globalIndex + i) / Math.max(1, total - 1);
      const alpha = Math.max(0.15, 1 - 0.85 * t);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    globalIndex += segment.length;
  }
}

function lastSample(segments: readonly TrackSample[][]): TrackSample | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.length > 0) return seg[seg.length - 1];
  }
  return null;
}

/**
 * The forward tracks and their markers, in world space so they pan and zoom
 * with the map: the current-orbit prediction, each planned manoeuvre over it,
 * the SOI ring and the impact cross.
 */
export function paintPrediction(
  ctx: CanvasRenderingContext2D,
  {
    w,
    h,
    camera,
    predictionSegments,
    maneuverSegments,
    adjustedMap,
    encounterKind,
    impactLat,
    impactLon,
  }: Readonly<{
    w: number;
    h: number;
    camera: Camera;
    predictionSegments: readonly TrackSample[][];
    maneuverSegments: readonly TrackSample[][][];
    adjustedMap: MapProjection;
    encounterKind: EncounterKind | null;
    impactLat: number | undefined;
    impactLon: number | undefined;
  }>,
): void {
  ctx.clearRect(0, 0, w, h);

  const hasMain = predictionSegments.length > 0;
  const hasManeuvers = maneuverSegments.some((s) => s.length > 0);
  if (!hasMain && !hasManeuvers) return;

  ctx.setTransform(...cameraTransform(camera, w, h));
  // Compensate stroke + dash for camera zoom so they stay visually consistent at any scale.
  const screenLineWidth = 1.5;
  const screenDash = 4;
  ctx.lineWidth = screenLineWidth / camera.zoom;
  ctx.setLineDash([screenDash / camera.zoom, screenDash / camera.zoom]);

  // Current-orbit prediction: amber, faded proportional to time from now.
  drawFadedSegments(ctx, predictionSegments, adjustedMap, [255, 180, 64]);

  // Planned maneuvers: cyan, drawn over the main prediction.
  for (const segments of maneuverSegments) {
    drawFadedSegments(ctx, segments, adjustedMap, [64, 200, 255]);
  }

  ctx.setLineDash([]);

  // SOI marker: predictGroundTrack stops at a referenceBody change, so the last sample is the ground point at the transition.
  const last = encounterKind === null ? null : lastSample(predictionSegments);
  if (last !== null && Number.isFinite(last.lat) && Number.isFinite(last.lon)) {
    const { x: ex, y: ey } = adjustedMap(WORLD_W, WORLD_H, last.lat, last.lon);
    const r = 6 / camera.zoom;
    ctx.strokeStyle =
      encounterKind === "encounter"
        ? "rgba(64, 200, 255, 0.9)"
        : "rgba(255, 180, 64, 0.9)";
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, Math.PI * 2);
    ctx.stroke();
    // Inner dot so the ring is legible even at low zoom.
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(ex, ey, 1.5 / camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }

  if (impactLat !== undefined && impactLon !== undefined) {
    const { x: ix, y: iy } = adjustedMap(
      WORLD_W,
      WORLD_H,
      impactLat,
      impactLon,
    );
    const crossSize = 6 / camera.zoom;
    ctx.strokeStyle = "rgba(255, 64, 64, 0.9)";
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(ix - crossSize, iy - crossSize);
    ctx.lineTo(ix + crossSize, iy + crossSize);
    ctx.moveTo(ix + crossSize, iy - crossSize);
    ctx.lineTo(ix - crossSize, iy + crossSize);
    ctx.stroke();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * The vessel's dot and crosshair at a screen-space point. A held position is a
 * hollow ring on a dashed crosshair, shape rather than shade, the same
 * treatment SystemView gives a held craft.
 */
export function paintVesselMarker(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  held = false,
): void {
  const accent = canvasColor(canvas, "--color-accent-fg", "#00ff88");
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  if (held) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = accent;
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(0,255,136,0.6)";
  ctx.lineWidth = 1;
  ctx.setLineDash(held ? [2, 2] : []);
  const cross = 8;
  ctx.beginPath();
  ctx.moveTo(x - cross, y);
  ctx.lineTo(x + cross, y);
  ctx.moveTo(x, y - cross);
  ctx.lineTo(x, y + cross);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Where the model puts the craft, beside its observed marker: a dashed ring in the modelled mark's hue. */
export function paintModelledMarker(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.strokeStyle = canvasColor(canvas, "--color-warn-mark", "#d9a13b");
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
}
