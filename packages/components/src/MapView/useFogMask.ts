import {
  DEFAULT_MASK_HEIGHT,
  DEFAULT_MASK_WIDTH,
  useBodyFogMask,
} from "@gonogo/data";
import { useEffect, useRef, useState } from "react";

export type { BodyMask } from "@gonogo/data";

/**
 * Maintains an offscreen canvas that mirrors the fog mask, suitable for
 * drawing via drawImage into the world-space layer. Fog appears as a dark
 * overlay: alpha = 255 − maskAlpha, so fully-imaged regions are transparent
 * and un-imaged regions are opaque dark.
 *
 * Returns the canvas element and a version counter that increments on
 * every mask mutation, so the caller's render effect can key off one source
 * of truth. Exposing the canvas via useState (not useRef) means the first
 * render after the mask loads already has the element available — avoids
 * the "map un-fogged for one frame" flicker.
 */
export function useFogDisplayCanvas(bodyId: string | undefined): {
  canvas: HTMLCanvasElement | null;
  version: number;
  width: number;
  height: number;
} {
  const { mask, version } = useBodyFogMask(bodyId);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);

  // `mask` reference is stable across mutations; `version` bumps to signal
  // that mask.data bytes have changed and the canvas needs repainting.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version triggers repaint when mask bytes change
  useEffect(() => {
    if (!mask) return;
    if (typeof document === "undefined") return;
    let c = canvas;
    if (c?.width !== mask.width || c?.height !== mask.height) {
      c = document.createElement("canvas");
      c.width = mask.width;
      c.height = mask.height;
      imageDataRef.current = null;
      setCanvas(c);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let img = imageDataRef.current;
    if (img?.width !== mask.width || img?.height !== mask.height) {
      img = ctx.createImageData(mask.width, mask.height);
      imageDataRef.current = img;
    }
    const pixels = img.data;
    const source = mask.data;
    // RGBA = (0, 0, 0, 255 - alpha): dark where un-imaged, transparent where
    // fully imaged. Leaves a gradient over partially-imaged areas so the
    // edge of a pass is visible.
    for (let i = 0, p = 0; i < source.length; i++, p += 4) {
      pixels[p] = 0;
      pixels[p + 1] = 0;
      pixels[p + 2] = 0;
      pixels[p + 3] = 255 - source[i];
    }
    ctx.putImageData(img, 0, 0);
  }, [mask, version, canvas]);

  return {
    canvas,
    version,
    width: mask?.width ?? DEFAULT_MASK_WIDTH,
    height: mask?.height ?? DEFAULT_MASK_HEIGHT,
  };
}
