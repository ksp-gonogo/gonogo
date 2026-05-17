import type { SCANType } from "@gonogo/core";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { FogMaskCache } from "./FogMaskCache";
import type { FogMaskStore } from "./FogMaskStore";

const FogMaskCacheContext = createContext<FogMaskCache | null>(null);
const FogMaskStoreContext = createContext<FogMaskStore | null>(null);

/**
 * Binds a FogMaskCache to the active save profile. Re-creates the cache
 * when `profileId` changes, flushing and disposing the previous one so
 * pending writes aren't lost across switches.
 *
 * The app supplies `profileId` (sourced from its SaveProfileService). Keeping
 * the dependency flowing in via prop means this package stays ignorant of
 * save-profile concerns.
 */
export function FogMaskCacheProvider({
  store,
  profileId,
  children,
}: {
  store: FogMaskStore;
  profileId: string;
  children: ReactNode;
}) {
  const cache = useMemo(
    () => new FogMaskCache(store, profileId),
    [store, profileId],
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
    <FogMaskStoreContext.Provider value={store}>
      <FogMaskCacheContext.Provider value={cache}>
        {children}
      </FogMaskCacheContext.Provider>
    </FogMaskStoreContext.Provider>
  );
}

/**
 * Returns the underlying FogMaskStore, or null if no provider is mounted.
 * Useful for bulk operations that cross profile boundaries (e.g. deleting a
 * profile's fog data).
 */
export function useFogMaskStore(): FogMaskStore | null {
  return useContext(FogMaskStoreContext);
}

/**
 * Standalone store provider — useful when a modal portal renders outside
 * the `FogMaskCacheProvider` tree but still needs access to the store for
 * bulk operations (e.g. clearing a profile's fog on delete).
 */
export function FogMaskStoreProvider({
  store,
  children,
}: {
  store: FogMaskStore;
  children: ReactNode;
}) {
  return (
    <FogMaskStoreContext.Provider value={store}>
      {children}
    </FogMaskStoreContext.Provider>
  );
}

/**
 * Returns the current fog mask cache, or null if no provider is mounted
 * above. Fog is an optional dashboard feature — callers should handle null
 * by skipping the fog pipeline rather than erroring.
 */
export function useFogMaskCache(): FogMaskCache | null {
  return useContext(FogMaskCacheContext);
}

/**
 * Acquire the mask for a single (body, scanType) and re-render on mutation.
 * Returns the mask plus a monotonically-increasing version counter so
 * effects that depend on "mask changed" can key off it without comparing
 * bytes.
 *
 * When there is no provider, no body id, or no scan type, `mask` is
 * undefined.
 */
export function useBodyFogMask(
  bodyId: string | undefined,
  scanType: SCANType | undefined,
): {
  mask: import("./FogMaskCache").BodyMask | undefined;
  version: number;
} {
  const cache = useFogMaskCache();
  const [state, setState] = useState<{
    mask: import("./FogMaskCache").BodyMask | undefined;
    version: number;
  }>(() => ({
    mask:
      cache && bodyId && scanType !== undefined
        ? cache.get(bodyId, scanType)
        : undefined,
    version: 0,
  }));

  useEffect(() => {
    if (!cache || !bodyId || scanType === undefined) {
      setState({ mask: undefined, version: 0 });
      return;
    }
    let cancelled = false;
    const initial = cache.get(bodyId, scanType);
    setState({ mask: initial, version: 0 });
    const unsub = cache.onChange(bodyId, scanType, (m) =>
      setState((prev) => ({ mask: m, version: prev.version + 1 })),
    );
    cache.acquire(bodyId, scanType).then((m) => {
      if (cancelled) return;
      setState((prev) => ({ mask: m, version: prev.version + 1 }));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [cache, bodyId, scanType]);

  return state;
}
