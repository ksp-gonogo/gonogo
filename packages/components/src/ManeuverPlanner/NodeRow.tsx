import { formatDuration } from "@gonogo/core";
import type { ParsedManeuverNode } from "@gonogo/data";
import { CloseIcon } from "@gonogo/ui";
import styled from "styled-components";
import { FeasibilityChip } from "./styles";

interface NodeRowProps {
  node: ParsedManeuverNode;
  currentUT: number | undefined;
  availableDv: number;
  completed?: boolean;
  /** Omitted on phantom rows (the underlying node is already gone from KSP). */
  onDelete?: () => void;
}

export function NodeRow({
  node,
  currentUT,
  availableDv,
  completed = false,
  onDelete,
}: NodeRowProps) {
  const timeTo = currentUT !== undefined ? node.UT - currentUT : null;
  const feasible =
    completed || availableDv === 0 ? null : availableDv >= node.deltaVMagnitude;
  return (
    <NodeLi $completed={completed} role={completed ? "status" : undefined}>
      <NodeMain>
        <NodePrimary $completed={completed}>
          {completed
            ? "Burn complete"
            : `${node.deltaVMagnitude.toFixed(0)} m/s`}
          {feasible === false && (
            <FeasibilityChip $ok={false}>SHORT</FeasibilityChip>
          )}
        </NodePrimary>
        <NodeMeta>
          {completed
            ? "Removing in 10 s"
            : `burn in ${timeTo === null ? "—" : formatDuration(timeTo)}`}
        </NodeMeta>
      </NodeMain>
      {onDelete && (
        <DeleteButton type="button" onClick={onDelete} aria-label="Delete node">
          <CloseIcon size={12} />
        </DeleteButton>
      )}
    </NodeLi>
  );
}

const NodeLi = styled.li<{ $completed: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  background: ${({ $completed }) =>
    $completed ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  border: 1px solid
    ${({ $completed }) =>
      $completed ? "var(--color-status-go-bg)" : "var(--color-border-subtle)"};
  border-radius: 2px;
`;

const NodeMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
`;

const NodePrimary = styled.div<{ $completed: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: ${({ $completed }) =>
    $completed ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  font-weight: ${({ $completed }) => ($completed ? 600 : 400)};
`;

const NodeMeta = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
`;

const DeleteButton = styled.button`
  background: transparent;
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-text-muted);
  width: 22px;
  height: 22px;
  border-radius: 2px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background: var(--color-tag-dark-brown-bg);
    color: var(--color-tag-red-fg);
  }
`;
