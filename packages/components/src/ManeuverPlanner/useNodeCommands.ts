import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { usePanelDelay } from "@ksp-gonogo/ui-kit";
import { useCallback, useState } from "react";
import { useBurnCompletionTracker } from "./BurnCompletionTracker";
import type { NodeEditPatch } from "./NodeRow";
import { describePartialDispatch } from "./partialDispatch";
import { isSequence, type PlanResult } from "./planning";

/** The one-way light time a sent node crosses, and the reading it arrived in; `null` seconds where there is none to state. */
export interface SendDelay {
  oneWaySeconds: number | null;
  reading: Reading<Value<"s">> | null;
}

// An id-less node is off-contract; its array position is not an address the actuator resolves.
const UNADDRESSABLE =
  "This node arrived without an id, so there is nothing to address the command to.";

/** The node commands, the burn-completion tracker that auto-removes flown nodes, and the error line both report into. */
export function useNodeCommands(
  nodes: readonly ParsedManeuverNode[],
  plan: PlanResult | null,
) {
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Node commands actuate the flight plan, so each is subject to signal delay.
  const addNodeCmd = useCommand("vessel.maneuver.add");
  const updateNodeCmd = useCommand("vessel.maneuver.update");
  const removeNodeCmd = useCommand("vessel.maneuver.remove");
  usePanelDelay(addNodeCmd);
  usePanelDelay(updateNodeCmd);
  usePanelDelay(removeNodeCmd);

  // Must stay referentially stable: the tracker's hold timers depend on it and would reset every sample.
  const removeNode = useCallback(
    (nodeId: string) => {
      void removeNodeCmd.send(
        { nodeId },
        { label: "Auto-remove completed node" },
      );
    },
    [removeNodeCmd.send],
  );
  const { completedNodes, maxDvByUt } = useBurnCompletionTracker(
    nodes,
    removeNode,
  );

  async function dispatchPlanBurns(toDispatch: PlanResult): Promise<void> {
    const burns = isSequence(toDispatch) ? toDispatch.burns : [toDispatch];
    let dispatched = 0;
    for (const b of burns) {
      try {
        await addNodeCmd.send(
          {
            ut: b.ut,
            radialOut: b.radial,
            normal: b.normal,
            prograde: b.prograde,
          },
          { label: "Add maneuver node" },
        );
      } catch (err) {
        // Only here are both counts known: what landed in KSP and what the plan asked for.
        throw new Error(
          describePartialDispatch({
            dispatched,
            total: burns.length,
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      dispatched += 1;
    }
  }

  async function handleCommit() {
    if (!plan) return;
    setCommitting(true);
    setError(null);
    try {
      await dispatchPlanBurns(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  async function handleDelete(nodeId: string) {
    if (!nodeId) {
      setError(UNADDRESSABLE);
      return;
    }
    try {
      await removeNodeCmd.send({ nodeId }, { label: "Remove maneuver node" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleEdit(nodeId: string, patch: NodeEditPatch) {
    if (!nodeId) {
      setError(UNADDRESSABLE);
      return;
    }
    try {
      await updateNodeCmd.send(
        {
          nodeId,
          ut: patch.ut,
          radialOut: patch.radial,
          normal: patch.normal,
          prograde: patch.prograde,
        },
        { label: "Update maneuver node" },
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function handleClearAll() {
    // Last node first, so the plan empties from the far end inward as the operator expects.
    for (let i = nodes.length - 1; i >= 0; i--) {
      await removeNodeCmd.send(
        { nodeId: nodes[i].id },
        { label: "Remove maneuver node" },
      );
    }
  }

  // The light time a node crosses, for the send control to state beside itself.
  const sendDelay: SendDelay = {
    oneWaySeconds: addNodeCmd.effectiveDelaySeconds,
    reading: addNodeCmd.delayReading,
  };

  return {
    sendDelay,
    committing,
    error,
    setError,
    completedNodes,
    maxDvByUt,
    handleCommit,
    handleDelete,
    handleEdit,
    handleClearAll,
  };
}
