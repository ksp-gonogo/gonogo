import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { BodyMask } from "../types";
import { CoverageMaskCache } from "./CoverageMaskCache";

const CoverageMaskCacheContext = createContext<CoverageMaskCache | null>(null);

/**
 * Constructs one CoverageMaskCache for the tree below it.
 *
 * @category Maps and coverage
 */
export function CoverageMaskCacheProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [cache] = useState(() => new CoverageMaskCache());
  return (
    <CoverageMaskCacheContext.Provider value={cache}>
      {children}
    </CoverageMaskCacheContext.Provider>
  );
}

/**
 * Returns the current coverage mask cache, or null if no provider is mounted
 * above. Coverage is an optional dashboard feature, callers should handle null
 * by skipping the coverage pipeline rather than erroring.
 *
 * @category Maps and coverage
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
 *
 * @category Maps and coverage
 */
export function useBodyCoverageMask(
  bodyId: string | undefined,
  layerId: string | undefined,
): {
  mask: BodyMask | undefined;
  version: number;
} {
  const cache = useCoverageMaskCache();
  const [state, setState] = useState<{
    mask: BodyMask | undefined;
    version: number;
  }>(() => ({
    mask:
      cache && bodyId && layerId !== undefined
        ? cache.acquire(bodyId, layerId)
        : undefined,
    version: 0,
  }));

  useEffect(() => {
    if (!cache || !bodyId || layerId === undefined) {
      setState({ mask: undefined, version: 0 });
      return;
    }
    setState({ mask: cache.acquire(bodyId, layerId), version: 0 });
    return cache.onChange(bodyId, layerId, (m) =>
      setState((prev) => ({ mask: m, version: prev.version + 1 })),
    );
  }, [cache, bodyId, layerId]);

  return state;
}
