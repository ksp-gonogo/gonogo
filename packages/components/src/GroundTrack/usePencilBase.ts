import { useEffect, useMemo, useState } from "react";
import {
  coastBoostFor,
  DETAIL_SKETCH,
  type DrawnSketch,
  type PencilPalette,
  paletteFromTheme,
  pencilSketch,
  pencilSketchSliced,
  REMOTE_BELOW,
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

/** The close-zoom sketch with the paper it is laid on. */
export type InkSketch = DrawnSketch & { paper: string };

const drawnCache = new WeakMap<HTMLImageElement, Map<string, InkSketch>>();

/**
 * The close-zoom pencil sketch of a body's texture: the world's own pixel size
 * and a grid eight times finer, so a coast sits where the texture has it when
 * the map is zoomed in. Built in slices after the texture loads, so no frame
 * waits for it, and kept per texture. Only for a body detailed enough to show
 * terrain from home. `null` until it is ready, while there is no texture, or
 * where the platform cannot draw one; the whole-map sketch shows meanwhile.
 */
export function useDetailPencilBase(
  textureImage: HTMLImageElement | null,
  textureKey: string | undefined,
  detail: number,
  enabled: boolean,
): InkSketch | null {
  const palette = useActivePalette();
  const [built, setBuilt] = useState<InkSketch | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: textureKey names the body the sketch is seeded by
  useEffect(() => {
    if (!enabled || !textureImage || detail < REMOTE_BELOW) {
      setBuilt(null);
      return;
    }
    const cacheKey = `${detail}|${JSON.stringify(palette)}`;
    const cached = drawnCache.get(textureImage)?.get(cacheKey);
    if (cached) {
      setBuilt(cached);
      return;
    }
    setBuilt(null);
    let stale = false;
    pencilSketchSliced(
      textureImage,
      {
        palette,
        detail,
        width: DETAIL_SKETCH.width,
        height: DETAIL_SKETCH.height,
        seed: seedFor(textureKey ?? ""),
        fineness: DETAIL_SKETCH.fineness,
        hatchSpacing: DETAIL_SKETCH.hatchSpacing,
        lineScale: DETAIL_SKETCH.lineScale,
        transparent: true,
        coarse: {
          width: SKETCH_WIDTH,
          height: SKETCH_HEIGHT,
          hatchEvery: DETAIL_SKETCH.coarseHatchEvery,
        },
      },
      () => stale,
    )
      .then((made) => {
        if (!made || stale) return;
        const drawn = { ...made, paper: palette.paper };
        const forImage = drawnCache.get(textureImage) ?? new Map();
        forImage.clear();
        forImage.set(cacheKey, drawn);
        drawnCache.set(textureImage, forImage);
        setBuilt(drawn);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [enabled, textureImage, textureKey, detail, palette]);
  return built;
}

/**
 * Whether the map's base is the pencil sketch and not the body's own texture.
 * A base-layer augment such as a coverage map paints the real picture over the
 * sketch where it has scanned, so with one active the sketch is always the
 * base. Without one the texture is the base, and the sketch stands in only for a
 * body the save has explicitly never reached: a visit state that is absent or
 * has not arrived keeps the texture.
 */
export function baseIsSketch(
  bodyVisited: boolean | undefined,
  baseAugmentActive: boolean,
): boolean {
  return baseAugmentActive || bodyVisited === false;
}
