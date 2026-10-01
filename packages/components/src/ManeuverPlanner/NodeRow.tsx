import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { type CarriedCurrency, datedFrom, value } from "@ksp-gonogo/sitrep-sdk";
import { CloseIcon, PencilIcon } from "@ksp-gonogo/ui";
import { Button, Countdown, IconButton, Unit } from "@ksp-gonogo/ui-kit";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { useState } from "react";
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
  /** What the plan was last reported by, so a held plan draws held figures. */
  from?: readonly CarriedCurrency[];
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
  from,
  completed = false,
  onDelete,
  onEdit,
}: NodeRowProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const timeTo = currentUT !== undefined ? node.UT - currentUT : null;
  const dated = <UnitSymbol extends string>(
    figure: ReturnType<typeof value<UnitSymbol>>,
  ) => (from === undefined ? figure : datedFrom(from, figure));
  const feasible =
    completed || availableDv === null
      ? null
      : availableDv >= node.deltaVMagnitude;
  return (
    <li
      style={completed ? NODE_LI_COMPLETED : NODE_LI_ACTIVE}
      role={completed ? "status" : undefined}
    >
      <div style={NODE_MAIN_STYLE}>
        <div style={completed ? NODE_PRIMARY_COMPLETED : NODE_PRIMARY_ACTIVE}>
          {completed ? (
            "Burn complete"
          ) : (
            <Unit
              value={dated(value("m/s", node.deltaVMagnitude))}
              format="m/s"
              decimals={0}
            />
          )}
          {feasible === false && (
            <FeasibilityChip $ok={false}>SHORT</FeasibilityChip>
          )}
        </div>
        <div style={NODE_META_STYLE}>
          {completed ? (
            "Removing in 10 s"
          ) : timeTo !== null && timeTo < 0 ? (
            // A burn stopped short keeps its node past its own instant; Countdown is unsigned, so the tense carries it.
            <>
              burn was <Countdown value={dated(value("s", -timeTo))} /> ago
            </>
          ) : (
            <>
              burn in{" "}
              <Countdown
                value={timeTo === null ? null : dated(value("s", timeTo))}
              />
            </>
          )}
        </div>
      </div>
      <div style={ROW_ACTIONS_STYLE}>
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
      </div>
      {editing && onEdit && (
        <div style={EDIT_PANEL_STYLE}>
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
        </div>
      )}
    </li>
  );
}

const NODE_LI_BASE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: "var(--gap-related)",
  padding: "var(--inset-surface)",
  borderRadius: "var(--radius-regular)",
};

const NODE_LI_ACTIVE: CSSProperties = {
  ...NODE_LI_BASE,
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
};

const NODE_LI_COMPLETED: CSSProperties = {
  ...NODE_LI_BASE,
  background: "var(--color-go-muted)",
  border: "1px solid var(--color-go-mark)",
};

const NODE_MAIN_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
  minWidth: 0,
};

const NODE_PRIMARY_BASE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
  fontSize: "var(--font-size-value)",
};

const NODE_PRIMARY_ACTIVE: CSSProperties = {
  ...NODE_PRIMARY_BASE,
  color: "var(--color-text-primary)",
  fontWeight: 400,
};

const NODE_PRIMARY_COMPLETED: CSSProperties = {
  ...NODE_PRIMARY_BASE,
  color: "var(--color-go-text)",
  fontWeight: 600,
};

const NODE_META_STYLE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-dim)",
  letterSpacing: "0.04em",
};

const ROW_ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
};

function StepButton({
  $active,
  ...rest
}: Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    $active: boolean;
    children?: ReactNode;
  }
>) {
  return (
    <IconButton
      style={$active ? STEP_BUTTON_ACTIVE : STEP_BUTTON_INACTIVE}
      {...rest}
    />
  );
}

const STEP_BUTTON_BASE: CSSProperties = {
  border: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-muted)",
  width: 22,
  height: 22,
  borderRadius: "var(--radius-regular)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const STEP_BUTTON_ACTIVE: CSSProperties = {
  ...STEP_BUTTON_BASE,
  background: "var(--color-surface-raised)",
};

const STEP_BUTTON_INACTIVE: CSSProperties = {
  ...STEP_BUTTON_BASE,
  background: "transparent",
};

const EDIT_PANEL_STYLE: CSSProperties = {
  gridColumn: "1 / -1",
  borderTop: "1px dashed var(--color-border-subtle)",
  paddingTop: "var(--inset-below-rule)",
  marginTop: "var(--gap-disclosure)",
};
