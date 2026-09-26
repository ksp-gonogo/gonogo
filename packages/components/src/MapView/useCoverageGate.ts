// MapView's paint gate, not an overlay: a base-layer augment reads the composite grid while painting its own surface, 0 uncovered (paint nothing) to 255 covered (full opacity).
import {
  type CoverageSourceDefinition,
  getCoverageSources,
  onCoverageSourcesChange,
} from "@ksp-gonogo/core";
import { type BodyMask, useCoverageMaskCache } from "@ksp-gonogo/data";
import { useEffect, useState, useSyncExternalStore } from "react";

export interface CoverageGate {
  /** Composite reveal intensity, one byte per cell, row-major, `width` by `height`. */
  data: Uint8Array | null;
  version: number;
  width: number;
  height: number;
  /**
   * True when a coverage source is registered and a
   * `CoverageMaskCacheProvider` can resolve its masks. False means paint fully
   * open, never a blanked map.
   */
  hasAnySource: boolean;
}

const DEFAULT_WEIGHT = 255;

/** Exported for direct unit testing without a canvas, pure per-pixel math. */
export function compositeCoverage(
  sources: readonly CoverageSourceDefinition[],
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

// A stable snapshot, since getCoverageSources() allocates per call and would loop useSyncExternalStore. Refreshed by a module-load subscription, so a source registered while no instance is mounted is not missed.
let cachedSources: CoverageSourceDefinition[] = getCoverageSources();
onCoverageSourcesChange(() => {
  cachedSources = getCoverageSources();
});
function getSourcesSnapshot(): CoverageSourceDefinition[] {
  return cachedSources;
}

export function useCoverageGate(
  bodyId: string | undefined,
  augmentSettings: Record<string, Record<string, unknown>> | undefined,
): CoverageGate {
  // Subscribed only to re-render on registry change; the cache is kept fresh at module scope.
  const sources = useSyncExternalStore(
    onCoverageSourcesChange,
    getSourcesSnapshot,
    getSourcesSnapshot,
  );
  const cache = useCoverageMaskCache();
  const [gate, setGate] = useState<CoverageGate>({
    data: null,
    version: 0,
    width: 0,
    height: 0,
    hasAnySource: cache != null && sources.length > 0,
  });

  useEffect(() => {
    // No cache provider: masks can never resolve, so degrade to fully open.
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
