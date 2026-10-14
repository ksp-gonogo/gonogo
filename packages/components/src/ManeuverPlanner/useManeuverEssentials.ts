import { useTelemetry } from "@ksp-gonogo/core";
import { DELTA_V_BUDGET, useProcessor } from "@ksp-gonogo/sitrep-client";
import {
  deriveReading,
  type LockedValue,
  type ManeuverNode,
  pickReading,
  type TinyEssential,
  unlessLocked,
} from "@ksp-gonogo/sitrep-sdk";

/** The next burn against what the craft can give it. */
export function useManeuverEssentials(): readonly TinyEssential[] {
  const maneuver = useTelemetry("vessel.maneuver");
  // The game's own vessel total, as the planner's feasibility check uses.
  const budget = useProcessor(DELTA_V_BUDGET);
  return [
    {
      label: "Node ΔV",
      value: deriveReading(
        maneuver,
        (m) => firstNodeDv(m.nodes),
        (m) => firstNodeDv(m.nodes),
      ),
    },
    {
      label: "Avail",
      value:
        budget === undefined
          ? undefined
          : pickReading(budget, (b) => b.totalVac ?? undefined),
    },
  ];
}

/** The next node's delta-v, or none while there is no node or the save cannot hold one. */
function firstNodeDv(nodes: ManeuverNode[] | LockedValue) {
  return unlessLocked(nodes)?.[0]?.dvTotal ?? undefined;
}
