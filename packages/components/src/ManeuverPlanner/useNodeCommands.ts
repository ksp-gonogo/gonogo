import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  commandSet,
  dehydrateArgs,
  type Reading,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
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

/** How long a node the game accepted may take to be listed before the wait is given up. */
const NODE_LISTING_TIMEOUT_MS = 15_000;

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
  const [error, setError] = useState<string | null>(null);
  /*
   * The node count the plan reaches once the nodes the game accepted are
   * listed. The command settles before the plan stream carries the node, and
   * until it does the Add control would invite a second press that plans the
   * burn twice.
   */
  const [expectedNodes, setExpectedNodes] = useState<number | null>(null);
  const adding = expectedNodes !== null && nodes.length < expectedNodes;

  useEffect(() => {
    if (expectedNodes === null) return;
    if (nodes.length >= expectedNodes) {
      setExpectedNodes(null);
      return;
    }
    const timer = setTimeout(() => {
      setExpectedNodes(null);
      setError("The new node has not appeared in the flight plan.");
    }, NODE_LISTING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [expectedNodes, nodes.length]);

  // Node commands actuate the flight plan, so each is subject to signal delay.
  const addNodeCmd = useCommand(ADD_NODE);
  // A node on its way from any widget at this centre, so a widget mounted after the press is as busy as the one that sent it.
  const addOnItsWay = addNodeCmd.inFlight.some(
    (row) =>
      row.predictedPhase === "in-transit" ||
      row.predictedPhase === "awaiting-reply" ||
      row.predictedPhase === "due",
  );
  // Read when the sends finish, so a node the plan lost in the meantime does not raise the count to reach.
  const nodeCountRef = useRef(nodes.length);
  nodeCountRef.current = nodes.length;
  const updateNodeCmd = useCommand(UPDATE_NODE);
  const removeNodeCmd = useCommand(REMOVE_NODE);

  // Ids a removal was sent for that the plan still lists: under delay the node outlives the send, so a second removal of it, by the operator or the tracker, would address a node already on its way out.
  const removalSentRef = useRef(new Set<string>());
  useEffect(() => {
    for (const id of removalSentRef.current) {
      if (!nodes.some((n) => n.id === id)) removalSentRef.current.delete(id);
    }
  }, [nodes]);

  // Must stay referentially stable: the tracker's hold timers depend on it and would reset every sample.
  const removeNode = useCallback(
    (nodeId: string) => {
      if (removalSentRef.current.has(nodeId)) return;
      removalSentRef.current.add(nodeId);
      removeNodeCmd
        .dangerouslySendWithoutInput(
          { nodeId },
          { label: "Auto-remove completed node" },
        )
        .catch(() => {
          removalSentRef.current.delete(nodeId);
        });
    },
    [removeNodeCmd.dangerouslySendWithoutInput],
  );
  const { completedNodes, watches } = useBurnCompletionTracker(
    nodes,
    removeNode,
    burnContext,
  );

  /*
   * The press that adds the plan's burns. Each is sent after the last is
   * answered, and the first refusal stops the rest, so a partly added sequence
   * is reported with how far it got.
   */
  const burns = plan === null ? [] : isSequence(plan) ? plan.burns : [plan];
  const commitCommand =
    burns.length === 0
      ? null
      : commandSet(
          burns.map((b, index) => {
            // The planned instant is typed; the command's own args carry it as UT seconds.
            const args = dehydrateArgs({
              ut: b.ut,
              radialOut: b.radial,
              normal: b.normal,
              prograde: b.prograde,
            });
            const label = "Add maneuver node";
            return addNodeCmd.with(args, {
              label,
              before: () => {
                if (index > 0) return;
                setCommitting(true);
                setError(null);
              },
              onRejected: (err) => {
                // Only here are both counts known: what KSP confirmed and what the plan asked for.
                setError(
                  describePartialDispatch({
                    confirmed: index,
                    total: burns.length,
                    err,
                    dispatch: { command: ADD_NODE, args, label },
                  }),
                );
              },
            });
          }),
          {
            order: "one-at-a-time",
            stopAtFirstFailure: true,
            onSettled: ({ confirmed, total }) => {
              setCommitting(false);
              if (confirmed === total) {
                setExpectedNodes(nodeCountRef.current + confirmed);
              }
            },
          },
        );

  // One removal at a time: a second would address a node by an id the first is about to retire.
  const removalUnavailable = removing ? "Another node is being removed" : null;

  const removeCommand = (nodeId: string) => {
    const label = "Remove maneuver node";
    return removeNodeCmd.with(
      { nodeId },
      {
        label,
        before: () => {
          removalSentRef.current.add(nodeId);
          setRemoving(true);
        },
        onConfirmed: () => setRemoving(false),
        onRejected: (err) => {
          removalSentRef.current.delete(nodeId);
          setRemoving(false);
          setError(
            describeNodeRejection(err, {
              command: REMOVE_NODE,
              args: { nodeId },
              label,
            }),
          );
        },
      },
    );
  };
  const removeUnavailable = (nodeId: string) =>
    !nodeId
      ? UNADDRESSABLE
      : removalSentRef.current.has(nodeId)
        ? "This node is already being removed"
        : removalUnavailable;

  // A node with no id cannot be named to the game, which would take "" for a node.
  const removable = nodes.filter((n) => n.id);
  const notAddressable = nodes.length - removable.length;
  const clearAllCommand =
    removable.length === 0
      ? null
      : commandSet(
          // Last node first, so the plan empties from the far end inward as the operator expects.
          removable
            .map((n) =>
              removeNodeCmd.with(
                { nodeId: n.id },
                {
                  label: "Remove maneuver node",
                  before: () => setRemoving(true),
                },
              ),
            )
            .reverse(),
          {
            order: "one-at-a-time",
            onSettled: ({ failed }) => {
              setRemoving(false);
              // The refusal is drawn on the command's own rail; the rest of the plan is still cleared.
              const notRemoved = failed + notAddressable;
              if (notRemoved > 0) {
                setError(
                  `${notRemoved} of ${nodes.length} nodes could not be removed.`,
                );
              }
            },
          },
        );

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
    // Outcomes of earlier edits that a confirmed one supersedes.
    const earlier = [
      ...updateNodeCmd.refusals,
      ...updateNodeCmd.failures,
      ...updateNodeCmd.undelivered,
    ];
    try {
      await updateNodeCmd.dangerouslySendWithoutInput(args, { label });
      for (const entry of earlier) updateNodeCmd.dismiss(entry.id);
      setError(null);
    } catch (err) {
      setError(
        describeNodeRejection(err, { command: UPDATE_NODE, args, label }),
      );
      throw err;
    }
  }

  // The light time a node crosses, for the send control to state beside itself.
  const sendDelay: SendDelay = {
    oneWaySeconds: addNodeCmd.effectiveDelaySeconds,
    reading: addNodeCmd.delayReading,
  };

  // A burn whose time the node would reach the craft at or after is advice only: the press is sent and the game decides on arrival.
  const arrivesLate =
    plan !== null &&
    (isSequence(plan) ? plan.burns : [plan]).some(
      (b) =>
        addNodeCmd.gateFor(
          dehydrateArgs({
            ut: b.ut,
            radialOut: b.radial,
            normal: b.normal,
            prograde: b.prograde,
          }),
        )?.blocked === true,
    );

  return {
    sendDelay,
    arrivesLate,
    addGateStopsPress: addNodeCmd.gateStopsPress,
    committing: committing || adding || addOnItsWay,
    adding,
    removing,
    error,
    setError,
    completedNodes,
    watches,
    commitCommand,
    removeCommand,
    removeUnavailable,
    clearAllCommand,
    handleEdit,
  };
}
