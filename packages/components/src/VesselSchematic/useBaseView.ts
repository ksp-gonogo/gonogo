import type { VesselTopology } from "@ksp-gonogo/core";
import { useMemo, useRef } from "react";
import { pickView } from "./shipView";

/**
 * The default view of a craft, found from its parts when the craft first
 * appears and kept while the same craft stays on screen. Parts staging away
 * change the symmetry `pickView` reads, so finding it again on every new
 * topology would turn the picture by itself mid-flight. A different root part
 * is a different craft, and finds its own default.
 */
export function useBaseView(topology: VesselTopology | undefined): number {
  const kept = useRef<{ root: number; view: number }>(undefined);
  return useMemo(() => {
    if (!topology) return 0;
    if (kept.current?.root === topology.rootFlightId) return kept.current.view;
    const view = pickView(topology.parts);
    kept.current = { root: topology.rootFlightId, view };
    return view;
  }, [topology]);
}
