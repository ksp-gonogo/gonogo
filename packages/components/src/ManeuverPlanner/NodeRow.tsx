import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import {
  type CarriedCurrency,
  classifyCommandRejection,
  datedFrom,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { CloseIcon, PencilIcon } from "@ksp-gonogo/ui";
import {
  Button,
  Countdown,
  IconButton,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import type { BurnInstants } from "./burnFlown";
import type { ThrustObservation } from "./conformance";
import { NodeEditor } from "./NodeEditor";
import { FeasibilityChip } from "./styles";
import { useEngineLitFor } from "./useEngineLitFor";

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
  currentUT: Value<"ut"> | undefined;
  /** Vessel ΔV available, or null when there is no usable reading. */
  availableDv: number | null;
  /** What the plan was last reported by, so a held plan draws held figures. */
  from?: readonly CarriedCurrency[];
  completed?: boolean;
  /** The propulsion latch, so a burn still running past its planned cutoff is not called passed. */
  thrust?: ThrustObservation;
  /** Omitted on phantom rows (the underlying node is already gone from KSP). */
  onDelete?: () => void;
  /** Holds the delete control while another removal is in flight. */
  deleteDisabled?: boolean;
  /** Omitted on phantom rows; omitted to hide the edit affordance entirely. */
  onEdit?: (patch: NodeEditPatch) => Promise<void> | void;
}

export function NodeRow({
  node,
  currentUT,
  availableDv,
  from,
  completed = false,
  thrust,
  onDelete,
  deleteDisabled = false,
  onEdit,
}: NodeRowProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  /*
   * The node's figures when an edit was sent. The editor stays open until the
   * listed node differs from them, so it closes on the picture the view clock
   * shows and not on the reply, which arrives before the plan does, and an
   * edit whose reply was lost still closes when its result turns up.
   */
  const [sent, setSent] = useState<{ from: string; replied: boolean } | null>(
    null,
  );
  const figures = figuresOf(node);
  useEffect(() => {
    if (sent === null || figures === sent.from) return;
    setSent(null);
    setEditing(false);
  }, [sent, figures]);
  const timeTo = currentUT && value("ut", node.UT).minus(currentUT);
  const dated = <UnitSymbol extends string>(
    figure: ReturnType<typeof value<UnitSymbol>>,
  ) => (from === undefined ? figure : datedFrom(from, figure));
  const litFor = useEngineLitFor();
  // Asked on every render, so the engine start is attributed while the burn's window still holds.
  const lit = litFor(
    node.id,
    instantsOf(node),
    thrust?.thrusting ? thrust.startedUt : null,
  );
  const phase = completed ? "ahead" : phaseOf(node, currentUT, lit);
  const editable = onEdit !== undefined && !completed && phase !== "passed";
  // A burn already flown or in progress has no shortfall to report: the figure is its planned size, and the available total is already being drawn down by the burn.
  const feasible =
    completed ||
    phase === "passed" ||
    phase === "underway" ||
    availableDv === null
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
          {phase === "passed" && (
            <Tooltip
              text="The node's time has passed; this is the size it was planned at"
              focusable
            >
              <span style={PHASE_CHIP_STYLE}>PASSED</span>
            </Tooltip>
          )}
          {phase === "underway" && (
            <Tooltip
              text="Burn under way; this is the size it was planned at, not what remains"
              focusable
            >
              <span style={PHASE_CHIP_STYLE}>BURNING</span>
            </Tooltip>
          )}
        </div>
        <div style={NODE_META_STYLE}>
          {completed ? (
            "Removing in 10 s"
          ) : phase === "underway" && pastCutoff(node, currentUT) ? (
            "burn still running"
          ) : phase === "underway" && node.cutoffUt !== null ? (
            <>
              burn ends in{" "}
              <Countdown
                value={
                  currentUT &&
                  dated(value("ut", node.cutoffUt).minus(currentUT))
                }
              />
            </>
          ) : timeTo?.isNegative() ? (
            // A burn stopped short keeps its node past its own instant; Countdown is unsigned, so the tense carries it.
            <>
              burn was <Countdown value={dated(timeTo.abs())} /> ago
            </>
          ) : (
            <>
              burn in <Countdown value={timeTo && dated(timeTo)} />
            </>
          )}
        </div>
      </div>
      <div style={ROW_ACTIONS_STYLE}>
        {editable && (
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
          <Button
            type="button"
            onClick={onDelete}
            disabled={deleteDisabled}
            disabledReason="Another node is being removed"
            aria-label="Delete node"
          >
            <CloseIcon size={12} />
          </Button>
        )}
      </div>
      {editing && editable && onEdit && (
        <div style={EDIT_PANEL_STYLE}>
          <NodeEditor
            node={node}
            currentUT={currentUT}
            saving={saving}
            landing={sent?.replied === true}
            onSave={async (patch) => {
              setSaving(true);
              try {
                await onEdit(patch);
                setSent({ from: figures, replied: true });
              } catch (err) {
                // A lost reply may still have run, so its landing closes the editor too.
                if (classifyCommandRejection(err).kind === "lost") {
                  setSent({ from: figures, replied: false });
                }
                throw err;
              } finally {
                setSaving(false);
              }
            }}
            onCancel={() => {
              setSent(null);
              setEditing(false);
            }}
          />
        </div>
      )}
    </li>
  );
}

/** Where a node stands against the view clock: still to come, in its burn window, or behind the craft. */
function phaseOf(
  node: ParsedManeuverNode,
  currentUT: Value<"ut"> | undefined,
  engineLit: boolean,
): "ahead" | "underway" | "passed" {
  if (currentUT === undefined) return "ahead";
  if (pastCutoff(node, currentUT)) return engineLit ? "underway" : "passed";
  if (
    node.ignitionUt !== null &&
    currentUT.greaterThanOrEqual(value("ut", node.ignitionUt))
  ) {
    return "underway";
  }
  return "ahead";
}

/** Whether the view clock is behind the end of the node's burn window, or its instant where no window is modelled. */
export function pastCutoff(
  node: ParsedManeuverNode,
  currentUT: Value<"ut"> | undefined,
): boolean {
  return (
    currentUT !== undefined &&
    currentUT.greaterThan(value("ut", node.cutoffUt ?? node.UT))
  );
}

function figuresOf(node: ParsedManeuverNode): string {
  return `${node.UT}|${node.deltaV.join(",")}`;
}

function instantsOf(node: ParsedManeuverNode): BurnInstants {
  return {
    ut: value("ut", node.UT),
    ignitionUt: node.ignitionUt === null ? null : value("ut", node.ignitionUt),
    cutoffUt: node.cutoffUt === null ? null : value("ut", node.cutoffUt),
  };
}

const PHASE_CHIP_STYLE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  padding: "var(--inset-chip)",
  borderRadius: "var(--radius-pill)",
  letterSpacing: "0.08em",
  border: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-dim)",
};

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
