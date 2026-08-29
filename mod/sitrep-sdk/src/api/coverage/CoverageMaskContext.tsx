import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CoverageMaskCache } from "./CoverageMaskCache";
import type { CoverageMaskStore } from "./CoverageMaskStore";

const CoverageMaskCacheContext = createContext<CoverageMaskCache | null>(null);
const CoverageMaskStoreContext = createContext<CoverageMaskStore | null>(null);

/** Shared bucket id used everywhere coverage masks are stored or fanned out over
 *  peers. There is no per-save-profile scoping; the storage layer keeps a slot
 *  for one only because the IndexedDB key shape encodes it. */
export const DEFAULT_PROFILE_ID = "default";

/**
 * Constructs a CoverageMaskCache and exposes it (plus the underlying store) via
 * context. The cache is disposed on unmount and flushed on beforeunload so
 * pending writes aren't lost.
 *
 * Internally the cache still namespaces every entry under a constant
 * "default" profile id: the storage layer was originally designed to
 * support multiple save profiles, but that concept has been retired and
 * there's only ever one bucket now.
 */
export function CoverageMaskCacheProvider({
  store,
  children,
}: {
  store: CoverageMaskStore;
  children: ReactNode;
}) {
  const cache = useMemo(
    () => new CoverageMaskCache(store, DEFAULT_PROFILE_ID),
    [store],
  );

  useEffect(() => {
    return () => {
      void cache.dispose();
    };
  }, [cache]);

  useEffect(() => {
    const handler = () => {
      void cache.flush();
    };
    globalThis.addEventListener("beforeunload", handler);
    return () => globalThis.removeEventListener("beforeunload", handler);
  }, [cache]);

  return (
    <CoverageMaskStoreContext.Provider value={store}>
      <CoverageMaskCacheContext.Provider value={cache}>
        {children}
      </CoverageMaskCacheContext.Provider>
    </CoverageMaskStoreContext.Provider>
  );
}

/**
 * Returns the underlying CoverageMaskStore, or null if no provider is mounted.
 * Useful for bulk operations that cross profile boundaries (e.g. deleting a
 * profile's coverage data).
 */
export function useCoverageMaskStore(): CoverageMaskStore | null {
  return useContext(CoverageMaskStoreContext);
}

/**
 * Standalone store provider: useful when a modal portal renders outside
 * the `CoverageMaskCacheProvider` tree but still needs access to the store for
 * bulk operations (e.g. clearing a profile's coverage on delete).
 */
export function CoverageMaskStoreProvider({
  store,
  children,
}: {
  store: CoverageMaskStore;
  children: ReactNode;
}) {
  return (
    <CoverageMaskStoreContext.Provider value={store}>
      {children}
    </CoverageMaskStoreContext.Provider>
  );
}

/**
 * Returns the current coverage mask cache, or null if no provider is mounted
 * above. Coverage is an optional dashboard feature, callers should handle null
 * by skipping the coverage pipeline rather than erroring.
 */
export function useCoverageMaskCache(): CoverageMaskCache | null {
  return useContext(CoverageMaskCacheContext);
}

/**
 * Acquire the mask for a single (body, layerId) and re-render on mutation.
 * Returns the mask plus a monotonically-increasing version counter so
 * effects that depend on "mask changed" can key off it without comparing
 * bytes.
 *
 * When there is no provider, no body id, or no scan type, `mask` is
 * undefined.
 */
export function useBodyCoverageMask(
  bodyId: string | undefined,
  layerId: string | undefined,
): {
  mask: import("../types").BodyMask | undefined;
  version: number;
} {
  const cache = useCoverageMaskCache();
  const [state, setState] = useState<{
    mask: import("../types").BodyMask | undefined;
    version: number;
  }>(() => ({
    mask:
      cache && bodyId && layerId !== undefined
        ? cache.get(bodyId, layerId)
        : undefined,
    version: 0,
  }));

  useEffect(() => {
    if (!cache || !bodyId || layerId === undefined) {
      setState({ mask: undefined, version: 0 });
      return;
    }
    let cancelled = false;
    const initial = cache.get(bodyId, layerId);
    setState({ mask: initial, version: 0 });
    const unsub = cache.onChange(bodyId, layerId, (m) =>
      setState((prev) => ({ mask: m, version: prev.version + 1 })),
    );
    cache.acquire(bodyId, layerId).then((m) => {
      if (cancelled) return;
      setState((prev) => ({ mask: m, version: prev.version + 1 }));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [cache, bodyId, layerId]);

  return state;
}
