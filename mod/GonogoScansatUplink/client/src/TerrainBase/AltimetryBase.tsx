// SCANsat altimetry base-layer provider for MapView.
//
// Fills MapView's `map-view.base` REPLACE slot (T8c,
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md)
// with a standalone colourised elevation surface — SCANsat's own
// "Altimetry" map mode. Headless: renders no JSX, hands MapView a canvas
// via `ctx.onLayer` whenever `ctx.activeLayerId` selects this augment.
//
// Mutually exclusive with `BiomeBase` — both register on `map-view.base`
// with distinct ids; MapView's own single-pick semantics (an unmatched
// `activeLayerId` means no augment renders) is what keeps them from ever
// drawing at once, so neither needs to know the other exists.
//
// Per settled model point 2 (T8c task text): this is a standalone
// colourised height surface REPLACING the map's base texture, not a tint
// drawn on top of it — the old MapView-internal `useHeightCanvas`'s
// baked-in ~0.7 ramp opacity is dropped; visibility now comes entirely
// from the T4 coverage paint-gate (see `paintTile.ts`'s coverage-alpha
// doc comment).

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

function AltimetryBase(ctx: SlotProps<"map-view.base">) {
  const body = ctx.bodyId ? getBody(ctx.bodyId) : undefined;
  const heightGrid = useScanHeightGrid(body?.name);

  useEffect(() => {
    if (ctx.activeLayerId !== ALTIMETRY_LAYER_ID) {
      ctx.onLayer(null, 0);
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
    );
    ctx.onLayer(canvas, Date.now());
  }, [ctx.activeLayerId, ctx.onLayer, ctx.coverageGate, heightGrid, body]);

  return null;
}

registerAugment({
  id: ALTIMETRY_LAYER_ID,
  augments: "map-view.base",
  requires: "scansat",
  component: AltimetryBase,
});

export { AltimetryBase };
