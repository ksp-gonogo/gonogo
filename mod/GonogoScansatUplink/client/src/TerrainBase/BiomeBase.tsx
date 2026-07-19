// SCANsat biome base-layer provider for MapView.
//
// Fills MapView's `map-view.base` REPLACE slot (T8c,
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md)
// with a standalone coloured biome-map surface — SCANsat's own "Biome"
// map mode. Headless: renders no JSX, hands MapView a canvas via
// `ctx.onLayer` whenever `ctx.activeLayerId` selects this augment.
//
// Mutually exclusive with `AltimetryBase` — see that module's header
// comment for why the two never need to coordinate directly.

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

function BiomeBase(ctx: SlotProps<"map-view.base">) {
  const body = ctx.bodyId ? getBody(ctx.bodyId) : undefined;
  const biomeGrid = useScanBiomeGrid(body?.name);

  useEffect(() => {
    if (ctx.activeLayerId !== BIOME_LAYER_ID) {
      ctx.onLayer(null, 0);
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
    );
    ctx.onLayer(canvas, Date.now());
  }, [ctx.activeLayerId, ctx.onLayer, ctx.coverageGate, biomeGrid, body]);

  return null;
}

registerAugment({
  id: BIOME_LAYER_ID,
  augments: "map-view.base",
  requires: "scansat",
  component: BiomeBase,
});

export { BiomeBase };
