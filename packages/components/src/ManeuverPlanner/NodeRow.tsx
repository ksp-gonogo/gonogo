import { formatDuration } from "@gonogo/core";
import type { ParsedManeuverNode } from "@gonogo/data";
import { CloseIcon, PencilIcon } from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import { LabeledInput } from "./LabeledInput";
import { FeasibilityChip } from "./styles";

export interface NodeEditPatch {
  ut: number;
  radial: number;
  normal: number;
  prograde: number;
}

interface NodeRowProps {
  node: ParsedManeuverNode;
  currentUT: number | undefined;
  availableDv: number;
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
      <RowActions>
        {onEdit && !completed && (
          <ActionButton
            type="button"
            $active={editing}
            onClick={() => setEditing((v) => !v)}
            aria-label={editing ? "Close editor" : "Edit node"}
          >
            <PencilIcon size={12} />
          </ActionButton>
        )}
        {onDelete && (
          <DeleteButton
            type="button"
            onClick={onDelete}
            aria-label="Delete node"
          >
            <CloseIcon size={12} />
          </DeleteButton>
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

interface NodeEditorProps {
  node: ParsedManeuverNode;
  currentUT: number | undefined;
  saving: boolean;
  onSave: (patch: NodeEditPatch) => Promise<void>;
  onCancel: () => void;
}

function NodeEditor({
  node,
  currentUT,
  saving,
  onSave,
  onCancel,
}: NodeEditorProps) {
  const [ut, setUt] = useState(node.UT);
  const [radial, setRadial] = useState(node.deltaV[0]);
  const [normal, setNormal] = useState(node.deltaV[1]);
  const [prograde, setProgade] = useState(node.deltaV[2]);
  const timeTo = currentUT !== undefined ? ut - currentUT : null;
  const dirty =
    ut !== node.UT ||
    radial !== node.deltaV[0] ||
    normal !== node.deltaV[1] ||
    prograde !== node.deltaV[2];
  return (
    <EditGrid>
      <LabeledInput
        label="UT"
        value={Number(ut.toFixed(3))}
        suffix="s"
        onChange={setUt}
      />
      <EditHint>
        burn in {timeTo === null ? "—" : formatDuration(timeTo)}
      </EditHint>
      <LabeledInput label="Prograde" value={prograde} onChange={setProgade} />
      <LabeledInput label="Normal" value={normal} onChange={setNormal} />
      <LabeledInput label="Radial" value={radial} onChange={setRadial} />
      <EditActions>
        <SecondaryButton type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          type="button"
          onClick={() => void onSave({ ut, radial, normal, prograde })}
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : "Save"}
        </PrimaryButton>
      </EditActions>
    </EditGrid>
  );
}

const NodeLi = styled.li<{ $completed: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: 8px;
  row-gap: 4px;
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

const RowActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const ActionButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? "var(--color-surface-raised)" : "transparent"};
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);
  width: 22px;
  height: 22px;
  border-radius: 2px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background: var(--color-surface-raised);
    color: var(--color-text-primary);
  }
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

const EditPanel = styled.div`
  grid-column: 1 / -1;
  border-top: 1px dashed var(--color-border-subtle);
  padding-top: 6px;
  margin-top: 2px;
`;

const EditGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const EditHint = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
  text-align: right;
`;

const EditActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding-top: 4px;
`;

const PrimaryButton = styled.button`
  background: var(--color-accent-bg);
  color: var(--color-accent-fg);
  border: 1px solid var(--color-accent-fg);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 2px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled.button`
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-subtle);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 2px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
