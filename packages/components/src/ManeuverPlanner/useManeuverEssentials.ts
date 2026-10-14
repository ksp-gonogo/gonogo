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
  stillTrue,
  type TinyEssential,
  unlessLocked,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { useEngineLitFor } from "./useEngineLitFor";

/** The next burn against what the craft can give it. */
export function useManeuverEssentials(): readonly TinyEssential[] {
  const maneuver = useTelemetry("vessel.maneuver");
  // The game's own vessel total, as the planner's feasibility check uses.
  const budget = useProcessor(DELTA_V_BUDGET);
  const nowUt = useViewUt();
  // The engine's latch, so a burn running past its planned cutoff is not called passed.
  const propulsion = stillTrue(useTelemetry("vessel.propulsion"), undefined);
  const startedUt = propulsion?.thrustStartedUt?.isFinite()
    ? propulsion.thrustStartedUt
    : null;
  const nodes = unlessLocked(maneuver.nodes.value);
  const litFor = useEngineLitFor();
  const passed = (n: ManeuverNode, now: Value<"ut">) =>
    nodePassed(n, now, startedUt, litFor);
  const underway = nodeUnderway(nodes, nowUt, passed);
  // Every node is behind the craft: a dash would say nothing about why there is no figure.
  const allPassed =
    nowUt !== undefined &&
    nodes != null &&
    nodes.length > 0 &&
    nodes.every((n) => passed(n, nowUt));
  return [
    {
      // The figure is the planned size, which a burn in progress has not been drawn down from.
      label: underway ? "Burn ΔV planned" : "Node ΔV",
      word: allPassed ? "PASSED" : undefined,
      value: deriveReading(
        maneuver,
        (m) => firstNodeDv(m.nodes, nowUt, passed),
        (m) => firstNodeDv(m.nodes, nowUt, passed),
      ),
    },
    {
      label: "Avail (VAC)",
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
  passed: (node: ManeuverNode, nowUt: Value<"ut">) => boolean,
): boolean {
  const node = nodes?.find((n) => nowUt === undefined || !passed(n, nowUt));
  if (node === undefined || nowUt === undefined) return false;
  const ignition = node.ignitionUt;
  return ignition != null && nowUt.greaterThanOrEqual(ignition);
}

/** Whether the craft is past a node's planned burn, and no engine lit for that burn is still running. */
function nodePassed(
  node: ManeuverNode,
  nowUt: Value<"ut">,
  thrustStartedUt: Value<"ut"> | null,
  litFor: ReturnType<typeof useEngineLitFor>,
): boolean {
  // Asked on every look, so the engine start is attributed while the burn's window still holds.
  const lit = litFor(
    node.id,
    {
      ut: node.ut,
      ignitionUt: node.ignitionUt ?? null,
      cutoffUt: node.cutoffUt ?? null,
    },
    thrustStartedUt,
  );
  return nowUt.greaterThan(node.cutoffUt ?? node.ut) && !lit;
}

/** The next node's delta-v that has not been flown past, or none while there is no such node or the save cannot hold one. */
function firstNodeDv(
  nodes: ManeuverNode[] | LockedValue,
  nowUt: Value<"ut"> | undefined,
  passed: (node: ManeuverNode, nowUt: Value<"ut">) => boolean,
) {
  const open = unlessLocked(nodes)?.find(
    (n) => nowUt === undefined || !passed(n, nowUt),
  );
  return open?.dvTotal ?? undefined;
}
