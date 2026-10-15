import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  dehydrateArgs,
  type Reading,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useRef, useState } from "react";
import { useBurnCompletionTracker } from "./BurnCompletionTracker";
import type { BurnContext } from "./burnFlown";
import type { NodeEditPatch } from "./NodeRow";
import {
  describeNodeRejection,
  describePartialDispatch,
} from "./partialDispatch";
import { isSequence, type PlanResult } from "./planning";

/** The one-way signal delay a sent node crosses, and the reading it arrived in; `null` seconds where there is none to state. */
export interface SendDelay {
  oneWaySeconds: number | null;
  reading: Reading<Value<"s">> | null;
}

const ADD_NODE = "vessel.maneuver.add";
const UPDATE_NODE = "vessel.maneuver.update";
const REMOVE_NODE = "vessel.maneuver.remove";

// An id-less node is off-contract; its array position is not an address the actuator resolves.
const UNADDRESSABLE =
  "This node arrived without an id, so there is nothing to address the command to.";

/** The node commands, the burn-completion tracker that auto-removes flown nodes, and the error line both report into. */
export function useNodeCommands(
  nodes: readonly ParsedManeuverNode[],
  plan: PlanResult | null,
  burnContext: BurnContext,
) {
  const [committing, setCommitting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Node commands actuate the flight plan, so each is subject to signal delay.
  const addNodeCmd = useCommand(ADD_NODE);
  const updateNodeCmd = useCommand(UPDATE_NODE);
  const removeNodeCmd = useCommand(REMOVE_NODE);

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
  const { completedNodes, watches } = useBurnCompletionTracker(
    nodes,
    removeNode,
    burnContext,
  );

  async function dispatchPlanBurns(toDispatch: PlanResult): Promise<void> {
    const burns = isSequence(toDispatch) ? toDispatch.burns : [toDispatch];
    let confirmed = 0;
    for (const b of burns) {
      // The planned instant is typed; the command's own args carry it as UT seconds.
      const args = dehydrateArgs({
        ut: b.ut,
        radialOut: b.radial,
        normal: b.normal,
        prograde: b.prograde,
      });
      const label = "Add maneuver node";
      try {
        await addNodeCmd.send(args, { label });
      } catch (err) {
        // Only here are both counts known: what KSP confirmed and what the plan asked for.
        throw new Error(
          describePartialDispatch({
            confirmed,
            total: burns.length,
            err,
            dispatch: { command: ADD_NODE, args, label },
          }),
        );
      }
      confirmed += 1;
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

  // One removal at a time: a second would address a node by an id the first is about to retire.
  async function whileRemoving(run: () => Promise<void>): Promise<void> {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    try {
      await run();
    } finally {
      removingRef.current = false;
      setRemoving(false);
    }
  }

  async function handleDelete(nodeId: string) {
    if (!nodeId) {
      setError(UNADDRESSABLE);
      return;
    }
    const label = "Remove maneuver node";
    await whileRemoving(async () => {
      try {
        await removeNodeCmd.send({ nodeId }, { label });
      } catch (err) {
        setError(
          describeNodeRejection(err, {
            command: REMOVE_NODE,
            args: { nodeId },
            label,
          }),
        );
      }
    });
  }

  async function handleEdit(nodeId: string, patch: NodeEditPatch) {
    if (!nodeId) {
      setError(UNADDRESSABLE);
      return;
    }
    const args = {
      nodeId,
      ut: patch.ut,
      radialOut: patch.radial,
      normal: patch.normal,
      prograde: patch.prograde,
    };
    const label = "Update maneuver node";
    try {
      await updateNodeCmd.send(args, { label });
      setError(null);
    } catch (err) {
      setError(
        describeNodeRejection(err, { command: UPDATE_NODE, args, label }),
      );
      throw err;
    }
  }

  function handleClearAll(): Promise<void> {
    return whileRemoving(clearAllNodes);
  }

  async function clearAllNodes() {
    let notRemoved = 0;
    // Last node first, so the plan empties from the far end inward as the operator expects.
    for (let i = nodes.length - 1; i >= 0; i--) {
      const nodeId = nodes[i].id;
      // A node with no id cannot be named to the game, which would take "" for a node.
      if (!nodeId) {
        notRemoved += 1;
        continue;
      }
      try {
        await removeNodeCmd.send({ nodeId }, { label: "Remove maneuver node" });
      } catch {
        // The refusal is drawn on the command's own rail; the rest of the plan is still cleared.
        notRemoved += 1;
      }
    }
    if (notRemoved > 0) {
      setError(`${notRemoved} of ${nodes.length} nodes could not be removed.`);
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
    removing,
    error,
    setError,
    completedNodes,
    watches,
    handleCommit,
    handleDelete,
    handleEdit,
    handleClearAll,
  };
}
