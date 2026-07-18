// MapView's paint-gate. NOT a fog overlay compositor — there is no dark
// fog layer in this design. A base-layer augment (e.g. an altimetry or
// biome map) calls useCoverageGate WHILE PAINTING ITS OWN SURFACE and
// indexes into the returned composite grid to decide each tile's alpha:
// 0 = fully un-covered (paint nothing / black), 255 = fully covered
// (paint at full opacity). See useFogMask.ts's header for the retired
// shape this replaces — that file is deleted in a later task once every
// caller has cut over.
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
  /** True when zero reveal sources are registered at all — the "no fog
   *  system mounted" case. A base-layer augment should treat this as
   *  "paint fully open," NOT "fully fogged" — an Uplink that registers a
   *  base-layer provider but no reveal source at all gets an ungated
   *  (always-visible) surface, which is the correct degenerate case, not
   *  an error state. */
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
let cachedSources: FogRevealSourceDefinition[] = getFogRevealSources();
function getSourcesSnapshot(): FogRevealSourceDefinition[] {
  return cachedSources;
}

export function useCoverageGate(
  bodyId: string | undefined,
  augmentSettings: Record<string, Record<string, unknown>> | undefined,
): CoverageGate {
  const sources = useSyncExternalStore(
    (onChange) =>
      onFogRevealSourcesChange(() => {
        cachedSources = getFogRevealSources();
        onChange();
      }),
    getSourcesSnapshot,
    getSourcesSnapshot,
  );
  const cache = useFogMaskCache();
  const [gate, setGate] = useState<CoverageGate>({
    data: null,
    version: 0,
    width: 0,
    height: 0,
    hasAnySource: sources.length > 0,
  });

  useEffect(() => {
    if (!cache || !bodyId || sources.length === 0) {
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
