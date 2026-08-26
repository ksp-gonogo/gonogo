import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { maneuverBasisLabels, value } from "@ksp-gonogo/sitrep-sdk";
import { CloseIcon, PencilIcon } from "@ksp-gonogo/ui";
import {
  Countdown,
  IconButton,
  LabeledInput,
  NULL_DISPLAY,
  PrimaryButton,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import { FeasibilityChip } from "./styles";

/**
 * An edit, in the same POSITIONAL slots the node arrived in. The field names are
 * the stock basis's and the slots are whatever basis the node declared, which is
 * why the editor labels its boxes from `node.frame` rather than from these.
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
  /** Vessel ΔV available, or null when there is no usable reading (NOT the same as zero). */
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
    // `=== 0` here made a spent craft's every node read as unknown rather than
    // short. A vessel with no ΔV left is telemetry, and it fails the comparison
    // like any other number; only an ABSENT reading declines to judge.
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
  const [slot0, slot1, slot2] = maneuverBasisLabels(node.frame);
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
        burn in <Countdown value={timeTo} />
      </EditHint>
      {/* Named from the burn's own basis, and in slot order, so the box an
          operator types an along-track burn into is the one that carries it.
          The stock and Frenet bases put different quantities in the same
          slots, and the field names below are only the first basis's. */}
      <LabeledInput label={slot2} value={prograde} onChange={setProgade} />
      <LabeledInput label={slot1} value={normal} onChange={setNormal} />
      <LabeledInput label={slot0} value={radial} onChange={setRadial} />
      <EditActions>
        <SecondaryButton type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </SecondaryButton>
        <CompactPrimaryButton
          type="button"
          onClick={() => void onSave({ ut, radial, normal, prograde })}
          disabled={saving || !dirty}
        >
          {saving ? "Saving..." : "Save"}
        </CompactPrimaryButton>
      </EditActions>
    </EditGrid>
  );
}

const NodeLi = styled.li<{ $completed: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: var(--space-8);
  row-gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  background: ${({ $completed }) =>
    $completed ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  border: 1px solid
    ${({ $completed }) =>
      $completed ? "var(--color-status-go-bg)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-xs);
`;

const NodeMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  min-width: 0;
`;

const NodePrimary = styled.div<{ $completed: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--font-size-sm);
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
  gap: var(--space-4);
`;

// The cursor, hover and colour transition come from the kit's IconButton;
// the bordered 22x22 box and its $active background are this row's.
const StepButton = styled(IconButton)<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? "var(--color-surface-raised)" : "transparent"};
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);
  width: 22px;
  height: 22px;
  border-radius: var(--radius-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
`;

// Same bordered 22x22 box as StepButton, in the alert hue. `padding: 0` is
// load-bearing: a bare <button> keeps the UA's 1px 6px, which leaves 8px of
// content width inside the border and squashes the 12px glyph to 8px wide.
const DeleteButton = styled.button`
  background: transparent;
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-text-muted);
  width: 22px;
  height: 22px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  &:hover {
    background: var(--color-tag-dark-brown-bg);
    color: var(--color-tag-red-fg);
  }
`;

const EditPanel = styled.div`
  grid-column: 1 / -1;
  border-top: 1px dashed var(--color-border-subtle);
  padding-top: var(--space-6);
  margin-top: var(--space-2);
`;

const EditGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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
  gap: var(--space-6);
  padding-top: var(--space-4);
`;

// The accent treatment and hover come from the kit; only the compact sizing
// and the align-self it sets for form footers are overridden here.
const CompactPrimaryButton = styled(PrimaryButton)`
  align-self: auto;
  font-size: var(--font-size-xs);
  padding: var(--space-4) var(--space-10);
`;

const SecondaryButton = styled.button`
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-subtle);
  font-size: var(--font-size-xs);
  padding: var(--space-4) var(--space-10);
  border-radius: var(--radius-xs);
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
