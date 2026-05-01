import type { ParsedManeuverNode } from "@gonogo/data";
import { EmptyState, TextButton } from "@gonogo/ui";
import { useMemo } from "react";
import styled from "styled-components";
import type { CompletedEntry } from "./BurnCompletionTracker";
import { NodeRow } from "./NodeRow";

interface ManeuverNodeListProps {
  nodes: readonly ParsedManeuverNode[];
  completedNodes: ReadonlyMap<number, CompletedEntry>;
  currentUT: number | undefined;
  availableDv: number;
  /** Resolves to a no-op the operator can ignore — we only surface the error
   *  via the orchestrator's `error` state. */
  onDelete: (id: number) => Promise<void> | void;
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
  onClearAll,
}: ManeuverNodeListProps) {
  // Live nodes + phantom entries for completed nodes that have already
  // disappeared from `o.maneuverNodes` (e.g. user manually deleted before the
  // 10 s hold elapsed). The phantom is rendered inert — no Delete button
  // wiring beyond letting the timer drop it on schedule.
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
        <NodeListUL>
          {displayedNodes.map((d) => (
            <NodeRow
              key={d.phantom ? `phantom-${d.node.UT}` : d.node.id}
              node={d.node}
              currentUT={currentUT}
              availableDv={availableDv}
              completed={d.completed}
              onDelete={d.phantom ? undefined : () => void onDelete(d.node.id)}
            />
          ))}
        </NodeListUL>
      )}
      {nodes.length > 1 && (
        <ClearAllRow>
          <TextButton type="button" onClick={() => void onClearAll()}>
            Clear all
          </TextButton>
        </ClearAllRow>
      )}
    </>
  );
}

const NodeListUL = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ClearAllRow = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
`;
