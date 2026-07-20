// SCANsat altimetry base-layer provider for MapView.
//
// Fills MapView's `map-view.base` STACKABLE slot (T8c,
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md;
// restacked per local_docs/spec-mapview-stackable-layers.md, 2026-07-20)
// with a standalone colourised elevation surface — SCANsat's own
// "Altimetry" map mode. Headless: renders no JSX, hands MapView a canvas
// via `ctx.onLayer` whenever this layer's own per-instance `show` setting
// (`ctx.augmentSettings[ALTIMETRY_LAYER_ID]?.show`, default true) is on.
//
// Draws ALONGSIDE `BiomeBase` — both register on `map-view.base` with
// distinct ids, and MapView composites every active layer's canvas rather
// than picking one. This layer sits at the BOTTOM of the stack (the base
// terrain colouring biome draws translucently on top of — see BiomeBase's
// own header comment) and declares `suppressesVanillaBase: true`: while
// either SCANsat base layer is registered, MapView's stock body texture
// never paints, full stop (spec: "don't like it, don't have the Uplink").
//
// Per settled model point 2 (T8c task text): this is a standalone
// colourised height surface REPLACING the map's base texture, not a tint
// drawn on top of it — the old MapView-internal `useHeightCanvas`'s
// baked-in ~0.7 ramp opacity is dropped; visibility now comes from the T4
// coverage paint-gate MULTIPLIED by this layer's own `layerOpacity` (see
// `paintTile.ts`'s `effectiveAlpha`) — at the BOTTOM of the stack this
// layer paints fully opaque (`layerOpacity = 1`) wherever it paints at
// all, since there's no stock texture beneath it to show through once
// vanilla is suppressed.

import {
  getBody,
  registerAugment,
  type SlotProps,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";
import { useScanHeightGrid } from "../FogReveal/useScanLayers";
import {
  BASE_LAYER_CANVAS_H,
  BASE_LAYER_CANVAS_W,
  paintTile,
} from "./paintTile";

export const ALTIMETRY_LAYER_ID = "scansat:altimetry";

/**
 * Five-stop elevation ramp: deep ocean → shallow → land → highlands →
 * peaks. Same stops as the retired `useScanLayerCanvas.ts`'s
 * `elevationRamp`, minus the baked-in alpha (opacity now comes from the
 * coverage gate, see this module's header comment). Tweaked for
 * KSP-typical altitudes; the caller normalises with the grid's actual
 * min/max so airless bodies (Mun) still get the full range.
 */
export function elevationToColour(t: number): string {
  if (t < 0.2) return "20, 50, 110";
  if (t < 0.4) return "40, 100, 160";
  if (t < 0.6) return "80, 150, 90";
  if (t < 0.8) return "140, 110, 60";
  return "220, 220, 220";
}

// The bottom of the SCANsat base-layer stack — fully opaque wherever it
// paints at all. There is no stock texture beneath it once vanilla is
// suppressed (`suppressesVanillaBase`, below), so nothing benefits from
// this layer being translucent; BiomeBase (drawn on top) is the one that
// needs a `layerOpacity` under 1 so this layer still shows through it.
const ALTIMETRY_LAYER_OPACITY = 1;

function AltimetryBase(ctx: SlotProps<"map-view.base">) {
  const body = ctx.bodyId ? getBody(ctx.bodyId) : undefined;
  const heightGrid = useScanHeightGrid(body?.name);
  // Per-layer toggle (spec: SCANsat layers default ON; `map-view.actions`
  // and the settings-panel checkbox both read/write this SAME value).
  const show = ctx.augmentSettings?.[ALTIMETRY_LAYER_ID]?.show !== false;

  useEffect(() => {
    if (!show) {
      ctx.onLayer(ALTIMETRY_LAYER_ID, null, 0);
      return;
    }
    if (!heightGrid || !body || typeof document === "undefined") return;

    // Fixed internal paint resolution — see paintTile.ts's header comment
    // for why this ignores ctx.width/ctx.height (the live viewport size).
    const canvas = document.createElement("canvas");
    canvas.width = BASE_LAYER_CANVAS_W;
    canvas.height = BASE_LAYER_CANVAS_H;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;

    const span = Math.max(1, heightGrid.maxMetres - heightGrid.minMetres);
    paintTile(
      c2d,
      heightGrid.width,
      heightGrid.height,
      body,
      ctx.coverageGate,
      (iLon, iLat) => {
        const idx = iLon * heightGrid.height + iLat;
        const m = heightGrid.metres[idx];
        const t = Math.max(0, Math.min(1, (m - heightGrid.minMetres) / span));
        return elevationToColour(t);
      },
      BASE_LAYER_CANVAS_W,
      BASE_LAYER_CANVAS_H,
      ALTIMETRY_LAYER_OPACITY,
    );
    ctx.onLayer(ALTIMETRY_LAYER_ID, canvas, Date.now());

    // Drop this layer's canvas immediately on unmount (e.g. the Domain
    // goes unavailable) rather than leaving it orphaned in MapView's
    // per-id canvas store forever — with a single-pick slot a stale entry
    // was harmless (the next selection just overwrote it); in the
    // stackable model nothing else would ever clear it.
    return () => ctx.onLayer(ALTIMETRY_LAYER_ID, null, 0);
  }, [show, ctx.onLayer, ctx.coverageGate, heightGrid, body]);

  return null;
}

registerAugment({
  id: ALTIMETRY_LAYER_ID,
  augments: "map-view.base",
  requires: "scansat",
  component: AltimetryBase,
  suppressesVanillaBase: true,
  settings: [
    {
      key: "show",
      type: "boolean",
      label: "Show altimetry",
      default: true,
    },
  ],
});

export { AltimetryBase };
