import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { BodyMask } from "../types";
import { CoverageMaskCache } from "./CoverageMaskCache";

const CoverageMaskCacheContext = createContext<CoverageMaskCache | null>(null);

/**
 * Gives the components below it one {@link CoverageMaskCache} holding the
 * ground each scanner layer has covered on each body. Useful for letting every
 * map on a screen draw the same coverage. Read with
 * {@link useCoverageMaskCache}. Used by the main and station screens.
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
 * The nearest {@link CoverageMaskCache}, or `null` when no
 * {@link CoverageMaskCacheProvider} is above. Useful for writing scanned
 * ground into the cache a map reads. Used by the ground track widget's coverage gate. On
 * `null`, skip drawing coverage.
 *
 * @category Maps and coverage
 */
export function useCoverageMaskCache(): CoverageMaskCache | null {
  return useContext(CoverageMaskCacheContext);
}

/**
 * The coverage mask for one body and layer, re-rendering whenever it changes.
 * Useful for showing the operator which ground of a body a scanner layer has
 * covered. Returns the mask and a `version` that goes up by one on each change,
 * so an effect can depend on the version rather than compare bytes.
 *
 * `mask` is `undefined` when there is no {@link CoverageMaskCacheProvider}, no
 * body id or no layer id.
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
