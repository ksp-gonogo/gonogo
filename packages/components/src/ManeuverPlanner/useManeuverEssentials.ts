import { useTelemetry } from "@ksp-gonogo/core";
import {
  DELTA_V_BUDGET,
  useProcessor,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  deriveReading,
  type LockedValue,
  type ManeuverNode,
  pickReading,
  type TinyEssential,
  unlessLocked,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";

/** The next burn against what the craft can give it. */
export function useManeuverEssentials(): readonly TinyEssential[] {
  const maneuver = useTelemetry("vessel.maneuver");
  // The game's own vessel total, as the planner's feasibility check uses.
  const budget = useProcessor(DELTA_V_BUDGET);
  const nowUt = useViewUt();
  const underway = nodeUnderway(unlessLocked(maneuver.nodes.value), nowUt);
  return [
    {
      // The figure is the planned size, which a burn in progress has not been drawn down from.
      label: underway ? "Node ΔV planned" : "Node ΔV",
      value: deriveReading(
        maneuver,
        (m) => firstNodeDv(m.nodes, nowUt),
        (m) => firstNodeDv(m.nodes, nowUt),
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

/** Whether a node's burn has begun and not ended, so its planned figure is not what remains. */
function nodeUnderway(
  nodes: ManeuverNode[] | null | undefined,
  nowUt: Value<"ut"> | undefined,
): boolean {
  const node = nodes?.find((n) => nowUt === undefined || !passed(n, nowUt));
  if (node === undefined || nowUt === undefined) return false;
  const ignition = node.ignitionUt;
  return ignition != null && nowUt.greaterThanOrEqual(ignition);
}

function passed(node: ManeuverNode, nowUt: Value<"ut">): boolean {
  return nowUt.greaterThan(node.cutoffUt ?? node.ut);
}

/** The next node's delta-v that has not been flown past, or none while there is no such node or the save cannot hold one. */
function firstNodeDv(
  nodes: ManeuverNode[] | LockedValue,
  nowUt: Value<"ut"> | undefined,
) {
  const open = unlessLocked(nodes)?.find(
    (n) => nowUt === undefined || !passed(n, nowUt),
  );
  return open?.dvTotal ?? undefined;
}
