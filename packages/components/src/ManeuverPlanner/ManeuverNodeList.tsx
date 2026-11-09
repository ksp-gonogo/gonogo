import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import type {
  AnyBoundCommand,
  CarriedCurrency,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState } from "@ksp-gonogo/ui";
import { Button, Stack } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import type { CompletedEntry } from "./BurnCompletionTracker";
import type { ThrustObservation } from "./conformance";
import { type NodeEditPatch, NodeRow, pastCutoff } from "./NodeRow";

interface ManeuverNodeListProps {
  nodes: readonly ParsedManeuverNode[];
  /** True until the plan has arrived, so an empty list is not read as an empty plan. */
  awaiting: boolean;
  /** True while a node the game accepted is not listed yet, so an empty list is not read as nothing having happened. */
  adding: boolean;
  completedNodes: ReadonlyMap<number, CompletedEntry>;
  currentUT: Value<"ut"> | undefined;
  /** Vessel ΔV available, or null when there is no usable reading. */
  availableDv: number | null;
  /** The propulsion latch, so a burn running past its planned cutoff reads as burning. */
  thrust?: ThrustObservation;
  /** What the plan was last reported by. */
  from?: readonly CarriedCurrency[];
  /** The command that removes the node `nodeId`. */
  removeCommand: (nodeId: string) => AnyBoundCommand;
  /** Why the node `nodeId` cannot be removed now, or null when it can. */
  removeUnavailable: (nodeId: string) => string | null;
  /** Failures surface through the orchestrator's `error` state, not here. */
  onEdit: (nodeId: string, patch: NodeEditPatch) => Promise<void> | void;
  /** The command that removes every node, or null when none can be named. */
  clearAllCommand: AnyBoundCommand | null;
  /** Why every node cannot be removed now, or null when they can. */
  clearAllUnavailable: string | null;
}

interface DisplayedNode {
  node: ParsedManeuverNode;
  completed: boolean;
  phantom: boolean;
}

export function ManeuverNodeList({
  nodes,
  awaiting,
  adding,
  completedNodes,
  currentUT,
  availableDv,
  thrust,
  from,
  removeCommand,
  removeUnavailable,
  onEdit,
  clearAllCommand,
  clearAllUnavailable,
}: ManeuverNodeListProps) {
  // A completed node already gone from the live list stays as an inert phantom until its hold expires.
  const displayedNodes = useMemo<DisplayedNode[]>(() => {
    const liveUts = new Set<number>();
    // A passed node with nothing to burn is the game's leftover, not a plan: the game keeps it until it is deleted, and listing it only reads as a burn that never came.
    const shown = nodes.filter(
      (n) =>
        n.deltaVMagnitude !== 0 ||
        !pastCutoff(n, currentUT) ||
        completedNodes.has(n.UT),
    );
    const live = shown.map<DisplayedNode>((n) => {
      liveUts.add(n.UT);
      return {
        node: n,
        completed: completedNodes.has(n.UT),
        phantom: false,
      };
    });
    const phantoms: DisplayedNode[] = [];
    for (const [ut, entry] of completedNodes) {
      if (!liveUts.has(ut))
        phantoms.push({ node: entry.snapshot, completed: true, phantom: true });
    }
    return [...live, ...phantoms];
  }, [nodes, completedNodes, currentUT]);

  return (
    <>
      {displayedNodes.length === 0 ? (
        <EmptyState>
          {adding
            ? "Adding maneuver node"
            : awaiting
              ? "Awaiting maneuver plan"
              : "No maneuver nodes planned"}
        </EmptyState>
      ) : (
        <Stack as="ul" style={NODE_LIST_STYLE}>
          {displayedNodes.map((d) => (
            <NodeRow
              key={d.phantom ? `phantom-${d.node.UT}` : d.node.id}
              node={d.node}
              currentUT={currentUT}
              availableDv={availableDv}
              thrust={thrust}
              from={from}
              completed={d.completed}
              removeCommand={d.phantom ? undefined : removeCommand(d.node.id)}
              removeUnavailable={
                d.phantom ? null : removeUnavailable(d.node.id)
              }
              onEdit={
                d.phantom ? undefined : (patch) => onEdit(d.node.id, patch)
              }
            />
          ))}
        </Stack>
      )}
      {nodes.length > 1 && clearAllCommand !== null && (
        <div style={CLEAR_ALL_ROW_STYLE}>
          <Button
            variant="ghost"
            size="sm"
            command={clearAllCommand}
            unavailable={clearAllUnavailable}
            blockedAriaLabel="Clear all"
          >
            Clear all
          </Button>
        </div>
      )}
    </>
  );
}

/** The gap is named, not sized, so a surrounding card tightens it like everything else. */
const NODE_LIST_STYLE = {
  gap: "var(--gap-related)",
  listStyle: "none",
  margin: 0,
  padding: 0,
} as const;

/** Trails the clear-all control, set off from the last row above it. */
const CLEAR_ALL_ROW_STYLE = {
  display: "flex",
  justifyContent: "flex-end",
  paddingTop: "var(--gap-list-footer)",
} as const;
