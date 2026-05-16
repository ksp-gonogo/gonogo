import type { BodyDefinition } from "@gonogo/core";
import {
  type DecodedBiomes,
  type DecodedHeights,
  tileToPixelRect,
  useScanBiomeGrid,
  useScanHeightGrid,
} from "@gonogo/data";
import { useEffect, useRef, useState } from "react";

const BIOME_CANVAS_W = 2048;
const BIOME_CANVAS_H = 1024;

/**
 * Paints a coloured biome layer for the given body — one rectangular
 * block per 1°×1° tile, filled with the stock biome colour from
 * `scan.biomeGrid`. Returns an HTMLCanvasElement the caller can
 * composite via `drawImage`, plus a version counter that bumps on
 * every repaint so render effects can key off a single source of
 * truth.
 *
 * Mirrors the `useFogDisplayCanvas` pattern: state-backed canvas
 * (not a ref) so the first render after data lands already has the
 * element available, no flicker frame.
 */
export function useBiomeCanvas(
  body: BodyDefinition | undefined,
  enabled: boolean,
): { canvas: HTMLCanvasElement | null; version: number } {
  const grid = useScanBiomeGrid(enabled ? body?.name : undefined);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (!grid || !body) return;
    if (typeof document === "undefined") return;

    let c = canvas;
    if (c?.width !== BIOME_CANVAS_W || c?.height !== BIOME_CANVAS_H) {
      c = document.createElement("canvas");
      c.width = BIOME_CANVAS_W;
      c.height = BIOME_CANVAS_H;
      setCanvas(c);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;

    paintBiomeCanvas(ctx, grid, body, BIOME_CANVAS_W, BIOME_CANVAS_H);
    setVersion((v) => v + 1);
  }, [enabled, grid, body, canvas]);

  return { canvas, version };
}

/**
 * Paints an elevation-gradient canvas for the body. Uses a
 * blue→green→brown→white ramp normalised to `[min, max]` from the
 * grid's metadata. The user composites this on top of the base layer
 * with an opacity slider — same canvas works whether the base is
 * altimetry or biome.
 */
export function useHeightCanvas(
  body: BodyDefinition | undefined,
  enabled: boolean,
): { canvas: HTMLCanvasElement | null; version: number } {
  const grid = useScanHeightGrid(enabled ? body?.name : undefined);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (!grid || !body) return;
    if (typeof document === "undefined") return;

    let c = canvas;
    if (c?.width !== BIOME_CANVAS_W || c?.height !== BIOME_CANVAS_H) {
      c = document.createElement("canvas");
      c.width = BIOME_CANVAS_W;
      c.height = BIOME_CANVAS_H;
      setCanvas(c);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;

    paintHeightCanvas(ctx, grid, body, BIOME_CANVAS_W, BIOME_CANVAS_H);
    setVersion((v) => v + 1);
  }, [enabled, grid, body, canvas]);

  return { canvas, version };
}

function paintBiomeCanvas(
  ctx: CanvasRenderingContext2D,
  grid: DecodedBiomes,
  body: BodyDefinition,
  maskW: number,
  maskH: number,
): void {
  ctx.clearRect(0, 0, maskW, maskH);
  for (let iLon = 0; iLon < grid.width; iLon++) {
    for (let iLat = 0; iLat < grid.height; iLat++) {
      const idx = iLon * grid.height + iLat;
      const biomeIdx = grid.indices[idx];
      if (biomeIdx === 0xff) continue;
      const biome = grid.biomes[biomeIdx];
      if (!biome) continue;
      const rect = tileToPixelRect(
        iLon,
        iLat,
        maskW,
        maskH,
        body.longitudeOffset ?? 0,
        body.latitudeOffset ?? 0,
      );
      ctx.fillStyle = rgbColour(biome.colour);
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      if (rect.x2 !== undefined && rect.x3 !== undefined) {
        ctx.fillRect(rect.x2, rect.y0, rect.x3 - rect.x2, rect.y1 - rect.y0);
      }
    }
  }
}

function paintHeightCanvas(
  ctx: CanvasRenderingContext2D,
  grid: DecodedHeights,
  body: BodyDefinition,
  maskW: number,
  maskH: number,
): void {
  ctx.clearRect(0, 0, maskW, maskH);
  const span = Math.max(1, grid.maxMetres - grid.minMetres);
  for (let iLon = 0; iLon < grid.width; iLon++) {
    for (let iLat = 0; iLat < grid.height; iLat++) {
      const idx = iLon * grid.height + iLat;
      const m = grid.metres[idx];
      const t = Math.max(0, Math.min(1, (m - grid.minMetres) / span));
      const rect = tileToPixelRect(
        iLon,
        iLat,
        maskW,
        maskH,
        body.longitudeOffset ?? 0,
        body.latitudeOffset ?? 0,
      );
      ctx.fillStyle = elevationRamp(t);
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      if (rect.x2 !== undefined && rect.x3 !== undefined) {
        ctx.fillRect(rect.x2, rect.y0, rect.x3 - rect.x2, rect.y1 - rect.y0);
      }
    }
  }
}

function rgbColour(packed: number): string {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Five-stop elevation ramp: deep ocean → shallow → land → highlands →
 * peaks. Tweaked for KSP-typical altitudes; the caller normalises
 * with the grid's actual min/max so airless bodies (Mun) still get
 * the full range.
 */
function elevationRamp(t: number): string {
  if (t < 0.2) return `rgba(20, 50, 110, 0.7)`;
  if (t < 0.4) return `rgba(40, 100, 160, 0.7)`;
  if (t < 0.6) return `rgba(80, 150, 90, 0.7)`;
  if (t < 0.8) return `rgba(140, 110, 60, 0.7)`;
  return `rgba(220, 220, 220, 0.7)`;
}
