// Mod-local coverage-gate hook. A near-verbatim copy of
// packages/components/src/MapView/useCoverageGate.ts's hook, ported here so
// widgets that live outside MapView's `map-view.base` slot tree (currently
// only Minimap.tsx) can compute the same per-tile reveal composite without
// importing @ksp-gonogo/components — that package's scan-canvas internals
// are slated for deletion once every consumer has its own copy (T9,
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md).
// Kept behaviourally identical to the original; a future task could hoist a
// single shared implementation into @ksp-gonogo/data without changing
// behaviour, the same way TerrainBase/paintTile.ts's tileToPixelRect is a
// deliberate byte-for-byte copy of FogReveal/scanDecode.ts's.
import {
  type BodyMask,
  type FogRevealSourceDefinition,
  getFogRevealSources,
  onFogRevealSourcesChange,
  useFogMaskCache,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useState, useSyncExternalStore } from "react";

export interface ScanCoverageGate {
  /** Composite reveal intensity, one byte per cell, row-major, same
   *  dimensions as `width`/`height`. 0 = fully un-covered (paint nothing /
   *  black), 255 = fully covered (paint at full opacity). */
  data: Uint8Array | null;
  version: number;
  width: number;
  height: number;
  /** True when at least one reveal source is registered AND a
   *  `FogMaskCacheProvider` is mounted to actually resolve its masks. False
   *  in either the "no fog system mounted" case (zero reveal sources
   *  registered) or the "no cache provider" case (sources are registered
   *  but nothing can fetch their masks). Consumers should treat false as
   *  "paint fully open," never "fully fogged." */
  hasAnySource: boolean;
}

const DEFAULT_WEIGHT = 255;

/** Exported for direct unit testing without a canvas — pure per-pixel math. */
export function compositeScanCoverage(
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
// Refreshed via an unconditional module-load subscription (mirrors the
// MapView original) so a reveal source registering before any hook instance
// is mounted is never missed.
let cachedSources: FogRevealSourceDefinition[] = getFogRevealSources();
onFogRevealSourcesChange(() => {
  cachedSources = getFogRevealSources();
});
function getSourcesSnapshot(): FogRevealSourceDefinition[] {
  return cachedSources;
}

export function useScanCoverageGate(
  bodyId: string | undefined,
  augmentSettings: Record<string, Record<string, unknown>> | undefined,
): ScanCoverageGate {
  const sources = useSyncExternalStore(
    onFogRevealSourcesChange,
    getSourcesSnapshot,
    getSourcesSnapshot,
  );
  const cache = useFogMaskCache();
  const [gate, setGate] = useState<ScanCoverageGate>({
    data: null,
    version: 0,
    width: 0,
    height: 0,
    hasAnySource: cache != null && sources.length > 0,
  });

  useEffect(() => {
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
        out[i] = compositeScanCoverage(
          sources,
          masksByLayer,
          augmentSettings,
          i,
        );
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
