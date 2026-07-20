// SCANsat biome base-layer provider for MapView.
//
// Fills MapView's `map-view.base` STACKABLE slot (T8c,
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md;
// restacked per local_docs/spec-mapview-stackable-layers.md, 2026-07-20)
// with a standalone coloured biome-map surface — SCANsat's own "Biome"
// map mode. Headless: renders no JSX, hands MapView a canvas via
// `ctx.onLayer` whenever this layer's own per-instance `show` setting
// (`ctx.augmentSettings[BIOME_LAYER_ID]?.show`, default true) is on.
//
// Draws ALONGSIDE `AltimetryBase` (both register on `map-view.base` with
// distinct ids; MapView composites every active layer rather than picking
// one), and specifically ON TOP of it — confirmed against SCANsat itself:
// its biome map draws translucent OVER the base terrain map, not the
// reverse. This layer therefore paints at a `layerOpacity` under 1
// (`BIOME_LAYER_OPACITY`, below) so the altimetry colouring underneath
// still reads through it, and declares `suppressesVanillaBase: true` for
// the same reason `AltimetryBase` does — see that module's header comment.

import {
  getBody,
  registerAugment,
  type SlotProps,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";
import { useScanBiomeGrid } from "../FogReveal/useScanLayers";
import {
  BASE_LAYER_CANVAS_H,
  BASE_LAYER_CANVAS_W,
  paintTile,
} from "./paintTile";

export const BIOME_LAYER_ID = "scansat:biome";

/** `0xRRGGBB` packed colour → `"r, g, b"` colour components (no `rgb()` wrapper — `paintTile`'s `withAlpha` adds that). */
export function packedColourToComponents(packed: number): string {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return `${r}, ${g}, ${b}`;
}

// SCANsat's own default `BiomeTransparency` is user-adjustable in-game;
// this is a fixed pick (no config surface for it yet — could ride the
// existing generic `settings` mechanism later if wanted) landing in the
// same ballpark: translucent enough that altimetry reads through, opaque
// enough that biome boundaries stay legible on their own.
export const BIOME_LAYER_OPACITY = 0.6;

function BiomeBase(ctx: SlotProps<"map-view.base">) {
  const body = ctx.bodyId ? getBody(ctx.bodyId) : undefined;
  const biomeGrid = useScanBiomeGrid(body?.name);
  // Per-layer toggle (spec: SCANsat layers default ON; `map-view.actions`
  // and the settings-panel checkbox both read/write this SAME value).
  const show = ctx.augmentSettings?.[BIOME_LAYER_ID]?.show !== false;

  useEffect(() => {
    if (!show) {
      ctx.onLayer(BIOME_LAYER_ID, null, 0);
      return;
    }
    if (!biomeGrid || !body || typeof document === "undefined") return;

    // Fixed internal paint resolution — see paintTile.ts's header comment
    // for why this ignores ctx.width/ctx.height (the live viewport size).
    const canvas = document.createElement("canvas");
    canvas.width = BASE_LAYER_CANVAS_W;
    canvas.height = BASE_LAYER_CANVAS_H;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;

    paintTile(
      c2d,
      biomeGrid.width,
      biomeGrid.height,
      body,
      ctx.coverageGate,
      (iLon, iLat) => {
        const idx = iLon * biomeGrid.height + iLat;
        const biomeIdx = biomeGrid.indices[idx];
        if (biomeIdx === 0xff) return null;
        const biome = biomeGrid.biomes[biomeIdx];
        if (!biome) return null;
        return packedColourToComponents(biome.colour);
      },
      BASE_LAYER_CANVAS_W,
      BASE_LAYER_CANVAS_H,
      BIOME_LAYER_OPACITY,
    );
    ctx.onLayer(BIOME_LAYER_ID, canvas, Date.now());

    // See AltimetryBase's identical cleanup for why this matters in the
    // stackable model — an unmounted layer must drop its own canvas.
    return () => ctx.onLayer(BIOME_LAYER_ID, null, 0);
  }, [show, ctx.onLayer, ctx.coverageGate, biomeGrid, body]);

  return null;
}

registerAugment({
  id: BIOME_LAYER_ID,
  // Draws ON TOP of AltimetryBase (priority 0, the default) within the
  // shared "scansat" Uplink group — see orderBaseLayers.ts: within a
  // group, ascending priority draws later (on top).
  priority: 10,
  augments: "map-view.base",
  requires: "scansat",
  component: BiomeBase,
  suppressesVanillaBase: true,
  settings: [
    {
      key: "show",
      type: "boolean",
      label: "Show biome",
      default: true,
    },
  ],
});

export { BiomeBase };
