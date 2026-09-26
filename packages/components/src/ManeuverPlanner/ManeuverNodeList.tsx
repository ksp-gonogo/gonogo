import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { EmptyState, TextButton } from "@ksp-gonogo/ui";
import { Stack } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import type { CompletedEntry } from "./BurnCompletionTracker";
import { type NodeEditPatch, NodeRow } from "./NodeRow";

interface ManeuverNodeListProps {
  nodes: readonly ParsedManeuverNode[];
  completedNodes: ReadonlyMap<number, CompletedEntry>;
  currentUT: number | undefined;
  /** Vessel ΔV available, or null when there is no usable reading. */
  availableDv: number | null;
  /** Failures surface through the orchestrator's `error` state, not here. */
  onDelete: (nodeId: string) => Promise<void> | void;
  onEdit: (nodeId: string, patch: NodeEditPatch) => Promise<void> | void;
  onClearAll: () => Promise<void> | void;
}

interface DisplayedNode {
  node: ParsedManeuverNode;
  completed: boolean;
  phantom: boolean;
}

export function ManeuverNodeList({
  nodes,
  completedNodes,
  currentUT,
  availableDv,
  onDelete,
  onEdit,
  onClearAll,
}: ManeuverNodeListProps) {
  // A completed node already gone from the live list stays as an inert phantom until its hold expires.
  const displayedNodes = useMemo<DisplayedNode[]>(() => {
    const liveUts = new Set<number>();
    const live = nodes.map<DisplayedNode>((n) => {
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
  }, [nodes, completedNodes]);

  return (
    <>
      {displayedNodes.length === 0 ? (
        <EmptyState>No maneuver nodes planned.</EmptyState>
      ) : (
        <Stack as="ul" style={NODE_LIST_STYLE}>
          {displayedNodes.map((d) => (
            <NodeRow
              key={d.phantom ? `phantom-${d.node.UT}` : d.node.id}
              node={d.node}
              currentUT={currentUT}
              availableDv={availableDv}
              completed={d.completed}
              onDelete={d.phantom ? undefined : () => void onDelete(d.node.id)}
              onEdit={
                d.phantom ? undefined : (patch) => onEdit(d.node.id, patch)
              }
            />
          ))}
        </Stack>
      )}
      {nodes.length > 1 && (
        <div style={CLEAR_ALL_ROW_STYLE}>
          <TextButton type="button" onClick={() => void onClearAll()}>
            Clear all
          </TextButton>
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
