import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { CloseIcon, PencilIcon } from "@ksp-gonogo/ui";
import { Button, Countdown, IconButton, Unit } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import { NodeEditor } from "./NodeEditor";
import { FeasibilityChip } from "./styles";

/**
 * An edit, in the positional slots the node arrived in. The field names are the
 * stock basis's; the slots are whatever basis the node declared, so the editor
 * labels its boxes from `node.frame`.
 */
export interface NodeEditPatch {
  ut: number;
  radial: number;
  normal: number;
  prograde: number;
}

interface NodeRowProps {
  node: ParsedManeuverNode;
  currentUT: number | undefined;
  /** Vessel ΔV available, or null when there is no usable reading. */
  availableDv: number | null;
  completed?: boolean;
  /** Omitted on phantom rows (the underlying node is already gone from KSP). */
  onDelete?: () => void;
  /** Omitted on phantom rows; omitted to hide the edit affordance entirely. */
  onEdit?: (patch: NodeEditPatch) => Promise<void> | void;
}

export function NodeRow({
  node,
  currentUT,
  availableDv,
  completed = false,
  onDelete,
  onEdit,
}: NodeRowProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const timeTo = currentUT !== undefined ? node.UT - currentUT : null;
  const feasible =
    completed || availableDv === null
      ? null
      : availableDv >= node.deltaVMagnitude;
  return (
    <NodeLi $completed={completed} role={completed ? "status" : undefined}>
      <NodeMain>
        <NodePrimary $completed={completed}>
          {completed ? (
            "Burn complete"
          ) : (
            <Unit
              value={value("m/s", node.deltaVMagnitude)}
              format="m/s"
              decimals={0}
            />
          )}
          {feasible === false && (
            <FeasibilityChip $ok={false}>SHORT</FeasibilityChip>
          )}
        </NodePrimary>
        <NodeMeta>
          {completed ? (
            "Removing in 10 s"
          ) : timeTo !== null && timeTo < 0 ? (
            // A burn stopped short keeps its node past its own instant; Countdown is unsigned, so the tense carries it.
            <>
              burn was <Countdown value={-timeTo} /> ago
            </>
          ) : (
            <>
              burn in <Countdown value={timeTo} />
            </>
          )}
        </NodeMeta>
      </NodeMain>
      <RowActions>
        {onEdit && !completed && (
          <StepButton
            type="button"
            $active={editing}
            onClick={() => setEditing((v) => !v)}
            aria-label={editing ? "Close editor" : "Edit node"}
          >
            <PencilIcon size={12} />
          </StepButton>
        )}
        {onDelete && (
          <Button type="button" onClick={onDelete} aria-label="Delete node">
            <CloseIcon size={12} />
          </Button>
        )}
      </RowActions>
      {editing && onEdit && (
        <EditPanel>
          <NodeEditor
            node={node}
            currentUT={currentUT}
            saving={saving}
            onSave={async (patch) => {
              setSaving(true);
              try {
                await onEdit(patch);
                setEditing(false);
              } finally {
                setSaving(false);
              }
            }}
            onCancel={() => setEditing(false)}
          />
        </EditPanel>
      )}
    </NodeLi>
  );
}

const NodeLi = styled.li<{ $completed: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: ${({ $completed }) =>
    $completed ? "var(--color-status-go-muted)" : "var(--color-surface-panel)"};
  border: 1px solid
    ${({ $completed }) =>
      $completed
        ? "var(--color-status-go-mark)"
        : "var(--color-border-subtle)"};
  border-radius: var(--radius-regular);
`;

const NodeMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-line);
  min-width: 0;
`;

const NodePrimary = styled.div<{ $completed: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  font-size: var(--font-size-value);
  color: ${({ $completed }) =>
    $completed ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  font-weight: ${({ $completed }) => ($completed ? 600 : 400)};
`;

const NodeMeta = styled.div`
  font-size: var(--font-size-caption);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
`;

const RowActions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
`;

const StepButton = styled(IconButton)<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? "var(--color-surface-raised)" : "transparent"};
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);
  width: 22px;
  height: 22px;
  border-radius: var(--radius-regular);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
`;

const EditPanel = styled.div`
  grid-column: 1 / -1;
  border-top: 1px dashed var(--color-border-subtle);
  padding-top: var(--inset-below-rule);
  margin-top: var(--gap-disclosure);
`;
