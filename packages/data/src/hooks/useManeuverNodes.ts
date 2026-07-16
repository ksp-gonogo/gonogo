import type { ManeuverNode } from "@ksp-gonogo/core";
import {
  useStream,
  type VesselManeuverLegacyState,
} from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";

/**
 * Parsed maneuver node plus a cached ΔV magnitude. Telemachus exposes
 * `o.maneuverNodes.deltaVMagnitude[id]` as its own key, but we subscribe
 * once to the complex `o.maneuverNodes` object (same pattern as
 * `dv.stages`) and derive the magnitude client-side — one subscription,
 * one broadcast per tick, regardless of how many nodes the vessel has.
 */
export interface ParsedManeuverNode extends ManeuverNode {
  /** Index of this node in `o.maneuverNodes` — use for update/remove. */
  id: number;
  /** √(x² + y² + z²) of `deltaV`. m/s. */
  deltaVMagnitude: number;
}

const EMPTY: readonly ParsedManeuverNode[] = [];

/**
 * List of planned maneuver nodes on the active vessel, parsed from the
 * `o.maneuverNodes` complex object. Empty array when none exist or the
 * source hasn't produced a value yet.
 *
 * Consumers that want a live "time to burn" countdown should combine the
 * node's `UT` with the current universal time — we don't bake the
 * subtraction in so the hook stays pure and only re-renders on actual
 * node-list changes, not every clock tick.
 */
export function useManeuverNodes(): readonly ParsedManeuverNode[] {
  const nodes = useStream<VesselManeuverLegacyState>(
    "vessel.maneuver.legacy",
  )?.nodes;
  return useMemo(() => {
    if (!Array.isArray(nodes) || nodes.length === 0) return EMPTY;
    return nodes.map((node, id) => ({
      ...node,
      id,
      deltaVMagnitude: Math.hypot(
        node.deltaV[0],
        node.deltaV[1],
        node.deltaV[2],
      ),
    }));
  }, [nodes]);
}
