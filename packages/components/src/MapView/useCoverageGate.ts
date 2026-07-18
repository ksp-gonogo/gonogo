// MapView's paint-gate. NOT a fog overlay compositor — there is no dark
// fog layer in this design. A base-layer augment (e.g. an altimetry or
// biome map) calls useCoverageGate WHILE PAINTING ITS OWN SURFACE and
// indexes into the returned composite grid to decide each tile's alpha:
// 0 = fully un-covered (paint nothing / black), 255 = fully covered
// (paint at full opacity). Replaces the old MapView-internal
// `useFogMask.ts`'s dark-overlay-canvas shape (deleted, T9) — there is no
// separate canvas to draw on top of the map anymore.
import {
  type FogRevealSourceDefinition,
  getFogRevealSources,
  onFogRevealSourcesChange,
} from "@ksp-gonogo/core";
import { type BodyMask, useFogMaskCache } from "@ksp-gonogo/data";
import { useEffect, useState, useSyncExternalStore } from "react";

export interface CoverageGate {
  /** Composite reveal intensity, one byte per cell, row-major, same
   *  dimensions as `width`/`height`. 0 = fully un-covered (paint nothing /
   *  black), 255 = fully covered (paint at full opacity). */
  data: Uint8Array | null;
  version: number;
  width: number;
  height: number;
  /** True when at least one reveal source is registered AND a
   *  `FogMaskCacheProvider` is mounted to actually resolve its masks.
   *  False in either the "no fog system mounted" case (zero reveal sources
   *  registered) or the "no cache provider" case (sources are registered
   *  but nothing can fetch their masks). A base-layer augment should treat
   *  false as "paint fully open," NOT "fully fogged" — an Uplink that
   *  registers a base-layer provider but no reveal source at all gets an
   *  ungated (always-visible) surface, which is the correct degenerate
   *  case, not an error state. A missing `FogMaskCacheProvider` must
   *  degrade the same way — never a blanked map. */
  hasAnySource: boolean;
}

const DEFAULT_WEIGHT = 255;

/** Exported for direct unit testing without a canvas — pure per-pixel math. */
export function compositeCoverage(
  sources: readonly FogRevealSourceDefinition[],
  masksByLayer: ReadonlyMap<string, BodyMask>,
  augmentSettings: Record<string, Record<string, unknown>> | undefined,
  pixelIndex: number,
): number {
  let reveal = 0;
  for (const source of sources) {
    if (augmentSettings?.[source.id]?.show === false) continue;
    const m = masksByLayer.get(source.id);
    if (!m) continue;
    const weight = source.weight ?? DEFAULT_WEIGHT;
    const v = Math.round((m.data[pixelIndex] * weight) / 255);
    if (v > reveal) reveal = v;
  }
  return reveal;
}

// Stable-reference snapshot cache — getFogRevealSources() allocates fresh
// every call, which would infinite-loop useSyncExternalStore directly.
//
// Refreshed via an UNCONDITIONAL module-load subscription (mirrors
// packages/core/src/AugmentSlot.tsx's slotCache/onAugmentsChange pattern),
// not from inside a component lifecycle: a reveal source can register or
// unregister while zero useCoverageGate instances are mounted (e.g. an
// Uplink SDK bundle registers a source before the user ever navigates to a
// MapView layout), and that change must not be missed.
let cachedSources: FogRevealSourceDefinition[] = getFogRevealSources();
onFogRevealSourcesChange(() => {
  cachedSources = getFogRevealSources();
});
function getSourcesSnapshot(): FogRevealSourceDefinition[] {
  return cachedSources;
}

export function useCoverageGate(
  bodyId: string | undefined,
  augmentSettings: Record<string, Record<string, unknown>> | undefined,
): CoverageGate {
  // Per-instance subscribe purely to trigger a re-render when the registry
  // changes — cachedSources itself is kept fresh by the module-load
  // subscription above regardless of whether any instance is mounted.
  const sources = useSyncExternalStore(
    onFogRevealSourcesChange,
    getSourcesSnapshot,
    getSourcesSnapshot,
  );
  const cache = useFogMaskCache();
  const [gate, setGate] = useState<CoverageGate>({
    data: null,
    version: 0,
    width: 0,
    height: 0,
    hasAnySource: cache != null && sources.length > 0,
  });

  useEffect(() => {
    // No FogMaskCacheProvider mounted: masks can never resolve regardless
    // of how many sources are registered. Degrade to fully-open, not a
    // gated state stuck with null data forever.
    if (!cache) {
      setGate((g) => ({ ...g, data: null, hasAnySource: false }));
      return;
    }
    if (!bodyId || sources.length === 0) {
      setGate((g) => ({ ...g, data: null, hasAnySource: sources.length > 0 }));
      return;
    }
    let cancelled = false;
    const masksByLayer = new Map<string, BodyMask>();
    const unsubs: Array<() => void> = [];
    let width = 0;
    let height = 0;

    function recompute(): void {
      if (cancelled || width === 0) return;
      const len = width * height;
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        out[i] = compositeCoverage(sources, masksByLayer, augmentSettings, i);
      }
      setGate((g) => ({
        data: out,
        version: g.version + 1,
        width,
        height,
        hasAnySource: true,
      }));
    }

    for (const source of sources) {
      cache.acquire(bodyId, source.id).then((m: BodyMask) => {
        if (cancelled) return;
        width = m.width;
        height = m.height;
        masksByLayer.set(source.id, m);
        unsubs.push(cache.onChange(bodyId, source.id, recompute));
        recompute();
      });
    }
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [bodyId, sources, augmentSettings, cache]);

  return gate;
}
