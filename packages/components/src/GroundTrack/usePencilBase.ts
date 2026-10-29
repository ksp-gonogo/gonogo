import { useEffect, useMemo, useState } from "react";
import {
  coastBoostFor,
  type PencilPalette,
  paletteFromTheme,
  pencilSketch,
  SKETCH_HEIGHT,
  SKETCH_WIDTH,
} from "./pencilSketch";

/** A seed that is the same for the same body on every screen, so the jitter does not change between renders. */
function seedFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** The sketch's colours from the active theme, read again whenever the document's root style moves, which is where the theme provider writes the theme. */
function useActivePalette(): PencilPalette {
  const [palette, setPalette] = useState(() => paletteFromTheme());
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(paletteFromTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return palette;
}

/**
 * The pencil sketch of a body's texture, drawn in the active theme's colours
 * and with coastlines weighted for a map shown `shownWidth` pixels across.
 * `null` while there is no texture, or where the platform cannot draw one, in
 * which case the caller paints the texture itself. Redrawn only when the
 * texture, the detail, the theme or the weight changes.
 */
export function usePencilBase(
  textureImage: HTMLImageElement | null,
  textureKey: string | undefined,
  detail: number,
  shownWidth: number | undefined,
): HTMLCanvasElement | null {
  const palette = useActivePalette();
  const boost = coastBoostFor(shownWidth ?? SKETCH_WIDTH);
  return useMemo(() => {
    if (!textureImage) return null;
    try {
      return pencilSketch(textureImage, {
        palette,
        detail,
        width: SKETCH_WIDTH,
        height: SKETCH_HEIGHT,
        seed: seedFor(textureKey ?? ""),
        coastBoost: boost,
      });
    } catch {
      return null;
    }
  }, [textureImage, textureKey, detail, boost, palette]);
}
