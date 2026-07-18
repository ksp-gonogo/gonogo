// SCANsat scanning-vessel footprint overlay for MapView.
//
// Fills MapView's `map-view.overlay` slot with each tracked vessel's ground-
// track rectangle — moved out of core MapView (T8a,
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md) so
// core MapView no longer reads `scansat.scanningVessels` or does any
// SCANsat-shaped geometry itself (Uplink invariant #5, "augment, don't
// embed").
//
// `map-view.overlay` is an OVERLAY slot: MapView passes down `project()`,
// the exact per-body-offset + camera chain the base map itself draws with,
// so this augment lands its rectangles on the same pixels without
// re-deriving that maths. This is a DIRECT PORT of the old MapView-internal
// `drawScanningFootprints` (packages/components/src/MapView/scanOverlay.ts)
// with one deliberate change: that function drew in WORLD-space coordinates
// onto a canvas the caller had already put through a zoom-scaling
// `ctx.setTransform(...)`, so it pre-divided its stroke width by camera zoom
// to cancel that transform's own scaling back out. `project()` already
// hands back post-camera-transform SCREEN pixels — there is no second
// canvas-level transform here to compensate for, so the stroke width is a
// fixed screen-space constant instead (see `STROKE_WIDTH_PX`). Everything
// else — the antimeridian-wrap split, the whole-globe span case — is an
// affine (zoom+pan) transform either way, so that geometry carries over
// unchanged.
//
// Presence-gated on `requires: "scansat"`: renders only while
// `scansat.available` is live, so an install without SCANsat never mounts
// it — zero impact on MapView for non-SCANsat users.

import type {} from "@ksp-gonogo/components"; // pulls MapView's "map-view.overlay" SlotRegistry merge into this program (see that module's own declare-module comment)
import type { SlotProps } from "@ksp-gonogo/core";
import { registerAugment } from "@ksp-gonogo/core";
import { useEffect, useRef } from "react";
import { useScanningVessels } from "../FogReveal/useScanLayers";
import type { SCANScanningVessel } from "../schema";

/** Fixed screen-pixel stroke width — see module doc comment for why this
 *  replaces the old world-space `1 / camZoom` compensation. `project()`
 *  already hands back post-camera-transform screen pixels, so a constant
 *  reads consistently at any zoom without re-deriving the camera's zoom
 *  factor here (same approach AnomalyOverlay's marker takes). */
const STROKE_WIDTH_PX = 1.5;

function wrapLon180(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/**
 * Paint every scanning vessel's footprint rectangle onto the overlay
 * canvas, in already-projected SCREEN-space pixels via `project`. Only
 * vessels on `bodyName` are drawn. `width` is the overlay layer's pixel
 * width (used for the whole-globe-span and antimeridian-wrap-right-side
 * cases, replacing the old `WORLD_W`).
 */
export function drawFootprints(
  ctx: Pick<
    CanvasRenderingContext2D,
    "fillRect" | "strokeRect" | "fillStyle" | "strokeStyle" | "lineWidth"
  >,
  width: number,
  bodyName: string | undefined,
  vessels: readonly SCANScanningVessel[],
  project: (lat: number, lon: number) => { x: number; y: number },
): void {
  if (!bodyName) return;

  for (const v of vessels) {
    if (v.body !== bodyName) continue;
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

    // Latitude band (no wrap — clamp to the poles, matching `project`'s
    // own body-offset clamp semantics before it's even applied here).
    const latTop = Math.min(90, v.subLatitude + halfLat);
    const latBot = Math.max(-90, v.subLatitude - halfLat);
    const { y: yTop } = project(latTop, 0);
    const { y: yBot } = project(latBot, 0);
    const rectY = Math.min(yTop, yBot);
    const rectH = Math.abs(yBot - yTop);

    // Longitude band, wrapped to [-180, 180) before projecting so the
    // wrap-split decision below is correct regardless of what the body
    // offset inside `project` does with the raw value.
    const lonLo = wrapLon180(v.subLongitude - halfLon);
    const lonHi = wrapLon180(v.subLongitude + halfLon);
    const { x: xLoRaw } = project(0, lonLo);
    const { x: xHiRaw } = project(0, lonHi);

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = STROKE_WIDTH_PX;

    if (halfLon * 2 >= 360) {
      // Spans the whole map — single full-width rect.
      ctx.fillRect(0, rectY, width, rectH);
      ctx.strokeRect(0, rectY, width, rectH);
    } else if (xHiRaw > xLoRaw) {
      const rw = xHiRaw - xLoRaw;
      ctx.fillRect(xLoRaw, rectY, rw, rectH);
      ctx.strokeRect(xLoRaw, rectY, rw, rectH);
    } else {
      // Wraps the antimeridian — two slices.
      const rwRight = width - xLoRaw;
      ctx.fillRect(xLoRaw, rectY, rwRight, rectH);
      ctx.strokeRect(xLoRaw, rectY, rwRight, rectH);
      ctx.fillRect(0, rectY, xHiRaw, rectH);
      ctx.strokeRect(0, rectY, xHiRaw, rectH);
    }
  }
}

function FootprintOverlay(ctx: SlotProps<"map-view.overlay">) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vessels = useScanningVessels();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;
    c2d.clearRect(0, 0, ctx.width, ctx.height);
    if (!Array.isArray(vessels)) return;
    drawFootprints(c2d, ctx.width, ctx.bodyName, vessels, ctx.project);
  }, [vessels, ctx.width, ctx.height, ctx.bodyName, ctx.project]);

  return (
    <canvas
      ref={canvasRef}
      width={ctx.width}
      height={ctx.height}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}

registerAugment({
  id: "scansat-footprint-overlay",
  augments: "map-view.overlay",
  requires: "scansat",
  component: FootprintOverlay,
});

export { FootprintOverlay };
