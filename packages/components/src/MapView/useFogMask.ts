import { SCAN_TYPE, type SCANType } from "@gonogo/core";
import {
  type BodyMask,
  DEFAULT_MASK_HEIGHT,
  DEFAULT_MASK_WIDTH,
  FOG_SCAN_TYPES,
  useBodyFogMask,
} from "@gonogo/data";
import { useEffect, useRef, useState } from "react";

export type { BodyMask } from "@gonogo/data";

/**
 * Per-scan-type display preferences. The dashboard exposes these as user
 * toggles in MapView config; the display canvas composites only the
 * enabled layers.
 *
 * Default: every type contributes to the fog reveal. Operators can
 * narrow this down (e.g. "only show AltimetryHiRes" for a high-res
 * survey mission, or "exclude Resource layers" to see altimetry
 * progress without the resource scan distraction).
 */
export type FogLayerVisibility = Partial<Record<SCANType, boolean>>;

/**
 * Per-layer alpha weight used when compositing. Higher-resolution
 * scans within a channel (HiRes vs LoRes) get a brighter reveal so the
 * operator can see at a glance which altimetry resolution they've
 * actually achieved on each tile. Only the SCAN_TYPE bits listed in
 * FOG_SCAN_TYPES need to appear — other entries (Anomaly, AnomalyDetail)
 * never enter the composite.
 */
const LAYER_WEIGHT: Partial<Record<SCANType, number>> = {
  [SCAN_TYPE.AltimetryLoRes]: 192,
  [SCAN_TYPE.AltimetryHiRes]: 255,
  [SCAN_TYPE.Biome]: 255,
  [SCAN_TYPE.ResourceLoRes]: 192,
  [SCAN_TYPE.ResourceHiRes]: 255,
};

/**
 * Maintains an offscreen canvas that composites the per-type fog masks
 * into one display layer, suitable for drawing via drawImage into the
 * world-space layer.
 *
 * Fog appears as a dark overlay: alpha = 255 − composedReveal, so
 * fully-imaged regions are transparent and un-imaged regions are
 * opaque dark.
 *
 * Composition rule: for each pixel, the canvas takes the MAX of every
 * enabled layer's contribution (`mask.data[i] * LAYER_WEIGHT[type] / 255`).
 * Within a channel (altimetry / resource), the HiRes weight is 255 and
 * LoRes is 192, so a HiRes-covered tile reveals more fully than a
 * LoRes-only tile.
 *
 * Returns the canvas + a version counter that bumps on any mask
 * mutation, so caller render effects can key off one source of truth.
 */
export function useFogDisplayCanvas(
  bodyId: string | undefined,
  visibility?: FogLayerVisibility,
): {
  canvas: HTMLCanvasElement | null;
  version: number;
  width: number;
  height: number;
} {
  // Subscribe to every per-type mask. `useBodyFogMask` returns a stable
  // ref + monotonic version per (body, scanType) pair; we re-paint on any
  // version bump.
  const altLoRes = useBodyFogMask(bodyId, SCAN_TYPE.AltimetryLoRes);
  const altHiRes = useBodyFogMask(bodyId, SCAN_TYPE.AltimetryHiRes);
  const biome = useBodyFogMask(bodyId, SCAN_TYPE.Biome);
  const resLoRes = useBodyFogMask(bodyId, SCAN_TYPE.ResourceLoRes);
  const resHiRes = useBodyFogMask(bodyId, SCAN_TYPE.ResourceHiRes);

  const layers: Array<{ mask: BodyMask | undefined; type: SCANType }> = [
    { mask: altLoRes.mask, type: SCAN_TYPE.AltimetryLoRes },
    { mask: altHiRes.mask, type: SCAN_TYPE.AltimetryHiRes },
    { mask: biome.mask, type: SCAN_TYPE.Biome },
    { mask: resLoRes.mask, type: SCAN_TYPE.ResourceLoRes },
    { mask: resHiRes.mask, type: SCAN_TYPE.ResourceHiRes },
  ];
  const versionSum =
    altLoRes.version +
    altHiRes.version +
    biome.version +
    resLoRes.version +
    resHiRes.version;

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);

  // Pick the first non-undefined mask for the canvas dimensions. All
  // per-type masks use the same default size (cache-controlled), so
  // any mask's dims work — we just need one to be loaded.
  const reference = layers.find((l) => l.mask !== undefined)?.mask;
  const width = reference?.width ?? DEFAULT_MASK_WIDTH;
  const height = reference?.height ?? DEFAULT_MASK_HEIGHT;

  // biome-ignore lint/correctness/useExhaustiveDependencies: versionSum + visibility cover the inputs; the layer refs are stable
  useEffect(() => {
    if (!reference) return;
    if (typeof document === "undefined") return;
    let c = canvas;
    if (c?.width !== width || c?.height !== height) {
      c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      imageDataRef.current = null;
      setCanvas(c);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let img = imageDataRef.current;
    if (img?.width !== width || img?.height !== height) {
      img = ctx.createImageData(width, height);
      imageDataRef.current = img;
    }
    const pixels = img.data;
    const len = width * height;

    // Build the list of enabled layers + their per-pixel byte source.
    // Defaulting to "enabled" when visibility is unset means a user
    // without explicit config still sees every layer compose.
    const enabledLayers = layers.flatMap((l) => {
      if (!l.mask) return [];
      if (visibility && visibility[l.type] === false) return [];
      const weight = LAYER_WEIGHT[l.type];
      if (weight === undefined) return [];
      return [{ src: l.mask.data, weight }];
    });

    if (enabledLayers.length === 0) {
      // No enabled layer → fully fogged. Paint solid dark.
      for (let p = 0; p < len * 4; p += 4) {
        pixels[p] = 0;
        pixels[p + 1] = 0;
        pixels[p + 2] = 0;
        pixels[p + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return;
    }

    // For each pixel, take max(src[i] * weight / 255) across layers.
    // RGBA = (0, 0, 0, 255 - reveal): dark where un-imaged, transparent
    // where any layer has imaged. Within a channel, HiRes weight=255 vs
    // LoRes weight=192 means a HiRes-covered tile reveals more fully.
    for (let i = 0, p = 0; i < len; i++, p += 4) {
      let reveal = 0;
      for (const layer of enabledLayers) {
        const v = (layer.src[i] * layer.weight) >> 8;
        if (v > reveal) reveal = v;
      }
      pixels[p] = 0;
      pixels[p + 1] = 0;
      pixels[p + 2] = 0;
      pixels[p + 3] = 255 - reveal;
    }
    ctx.putImageData(img, 0, 0);
  }, [versionSum, width, height, canvas, visibility, reference]);

  return {
    canvas,
    version: versionSum,
    width,
    height,
  };
}

export type { SCANType };
/** Re-export so callers can build the visibility map without importing
 *  @gonogo/data directly. */
export { FOG_SCAN_TYPES, SCAN_TYPE };
