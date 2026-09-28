import { useTelemetry } from "@ksp-gonogo/core";
import { DELTA_V_BUDGET, useProcessor } from "@ksp-gonogo/sitrep-client";
import { pickReading, type TinyEssential } from "@ksp-gonogo/sitrep-sdk";

/** The next burn against what the craft can give it. */
export function useManeuverEssentials(): readonly TinyEssential[] {
  const maneuver = useTelemetry("vessel.maneuver");
  // The game's own vessel total, as the planner's feasibility check uses.
  const budget = useProcessor(DELTA_V_BUDGET);
  return [
    { label: "Node ΔV", value: maneuver.nodes[0].dvTotal },
    {
      label: "Avail",
      value:
        budget === undefined
          ? undefined
          : pickReading(budget, (b) => b.totalVac ?? undefined),
    },
  ];
}
