import { DELTA_V_BUDGET, useProcessor } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import { type ParsedManeuverNode, useManeuverNodes } from "./useManeuverNodes";

/** One row of the feasibility verdict: a planned node plus whether we can pull it off. */
export interface NodeFeasibility {
  node: ParsedManeuverNode;
  /**
   * true : remaining ΔV after this burn is still non-negative
   * false: not enough ΔV left for this node
   * null : no ΔV telemetry yet, can't judge
   */
  ok: boolean | null;
  /** ΔV left after deducting this node + every earlier one, for display. */
  remainingDeltaV: number | null;
}

export interface ManeuverFeasibility {
  /** Per-node verdicts in UT order. */
  nodes: readonly NodeFeasibility[];
  /** True if every node is feasible AND we have ΔV telemetry. */
  allOk: boolean;
  /** True if any node is known-infeasible. */
  anyShort: boolean;
  /** Total ΔV across all planned nodes (m/s). */
  totalRequired: number;
  /** Vessel total ΔV at the time of the last sample (m/s), null when there is no usable reading. */
  available: number | null;
}

const EMPTY: ManeuverFeasibility = {
  nodes: [],
  allOk: true,
  anyShort: false,
  totalRequired: 0,
  available: null,
};

/**
 * Combines the maneuver-node list with the vessel's total ΔV into a
 * per-node feasibility verdict plus an overall summary. Runs the
 * deduction in UT order so a later node sees only the ΔV left after
 * earlier burns: matches how the pilot actually executes the plan.
 *
 * Available ΔV uses `totalVac` from the shared `DELTA_V_BUDGET` processor as a
 * first-order
 * approximation. Real stage-aware accounting (each node must fit inside
 * its owning stage) is a refinement, when we ship that, the interface
 * here doesn't change, only the computation inside.
 */
export function useManeuverFeasibility(): ManeuverFeasibility {
  const nodes = useManeuverNodes();
  // The one shared budget: the game's own vessel total, carried and dated
  // rather than blanked when it goes stale. A blanked budget reads as "no
  // opinion", and `allOk` is what a commit gate consults.
  const budget = useProcessor(DELTA_V_BUDGET)?.totalVac;
  const available =
    budget === null || budget === undefined ? null : budget.magnitude;

  return useMemo(() => {
    if (nodes.length === 0) {
      return { ...EMPTY, available };
    }

    // UT-sorted copy so chronological deduction matches execution order.
    const sorted = [...nodes].sort((a, b) => a.UT - b.UT);
    // Having a reading is not the same as having ΔV. This was `> 0`, which made a
    // SPENT craft indistinguishable from one we had heard nothing about: every node
    // came back `ok: null` (unknown) when the honest verdict is `false` (short). A
    // vessel that really has 0 m/s is telemetry, and rather emphatic telemetry.
    const haveTelemetry = available !== null;
    let remaining = available ?? 0;
    let totalRequired = 0;
    let anyShort = false;

    const verdicts: NodeFeasibility[] = sorted.map((node) => {
      totalRequired += node.deltaVMagnitude;
      if (!haveTelemetry) {
        return { node, ok: null, remainingDeltaV: null };
      }
      remaining -= node.deltaVMagnitude;
      const ok = remaining >= 0;
      if (!ok) anyShort = true;
      return { node, ok, remainingDeltaV: remaining };
    });

    return {
      nodes: verdicts,
      allOk: haveTelemetry && !anyShort,
      anyShort,
      totalRequired,
      available,
    };
  }, [nodes, available]);
}
