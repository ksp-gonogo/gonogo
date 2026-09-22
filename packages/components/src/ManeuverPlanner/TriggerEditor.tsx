import type { DataKey } from "@ksp-gonogo/core";
import { DataKeyPicker, GhostButton, PrimaryButton } from "@ksp-gonogo/ui";
import {
  Field,
  FieldLabel,
  Input,
  Row,
  Select,
  Stack,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { THRESHOLD_OPS, type ThresholdOp } from "./triggerTypes";

interface TriggerEditorProps {
  open: boolean;
  numericKeys: DataKey[];
  /** True when arming would no-op for reasons external to the editor, kept
   *  on the prop so the editor doesn't need to know which (no plan / etc.).
   *  The "no key" / "non-finite value" cases are handled internally. */
  externallyDisabled: boolean;
  onClose: () => void;
  onArm: (input: { dataKey: string; op: ThresholdOp; value: number }) => void;
}

export function TriggerEditor({
  open,
  numericKeys,
  externallyDisabled,
  onClose,
  onArm,
}: TriggerEditorProps) {
  const [triggerKey, setTriggerKey] = useState<string | null>(null);
  const [triggerOp, setTriggerOp] = useState<ThresholdOp>(">=");
  const [triggerValueDraft, setTriggerValueDraft] = useState("80000");

  if (!open) return null;
  const valueN = Number.parseFloat(triggerValueDraft);
  const armDisabled =
    !triggerKey || !Number.isFinite(valueN) || externallyDisabled;
  return (
    <Stack style={EDITOR_STYLE}>
      <div style={EDITOR_TITLE_STYLE}>When this condition holds</div>
      <Field style={EDITOR_FIELD_STYLE}>
        <FieldLabel>Telemetry key</FieldLabel>
        <DataKeyPicker
          subjectNoun="trigger subject"
          keys={numericKeys}
          value={triggerKey}
          onChange={setTriggerKey}
          placeholder="Search telemetry..."
          clearable
        />
      </Field>
      <Row as="div" style={OP_ROW_STYLE}>
        <Field style={EDITOR_FIELD_STYLE}>
          <FieldLabel htmlFor="mnv-trigger-op">Operator</FieldLabel>
          <Select
            id="mnv-trigger-op"
            value={triggerOp}
            onChange={(e) => setTriggerOp(e.target.value as ThresholdOp)}
          >
            {THRESHOLD_OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
        <Field style={EDITOR_FIELD_STYLE}>
          <FieldLabel htmlFor="mnv-trigger-value">Value</FieldLabel>
          <Input
            id="mnv-trigger-value"
            type="number"
            step="any"
            value={triggerValueDraft}
            onChange={(e) => setTriggerValueDraft(e.target.value)}
          />
        </Field>
      </Row>
      <div style={ACTIONS_STYLE}>
        <GhostButton type="button" onClick={onClose}>
          Cancel
        </GhostButton>
        <PrimaryButton
          onClick={() => {
            if (!triggerKey || !Number.isFinite(valueN)) return;
            onArm({ dataKey: triggerKey, op: triggerOp, value: valueN });
          }}
          disabled={armDisabled}
        >
          Arm
        </PrimaryButton>
      </div>
    </Stack>
  );
}

/** The editor is a panel-tier card. Stack carries the column; the gap is named
 *  rather than sized so the surface around it can retune it. */
const EDITOR_STYLE = {
  gap: "var(--gap-related)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
} as const;

const EDITOR_TITLE_STYLE = {
  fontSize: "var(--font-size-caption)",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--color-text-dim)",
} as const;

/** Each field takes an equal share of the operator row and may shrink below
 *  its content, which is what keeps a long telemetry key from pushing the
 *  value box off the card. */
const EDITOR_FIELD_STYLE = { flex: 1, minWidth: 0 } as const;

/** Two fields side by side. Row's own space-between would push them apart. */
const OP_ROW_STYLE = { justifyContent: "flex-start" } as const;

const ACTIONS_STYLE = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "var(--gap-related)",
  paddingTop: "var(--space-2)",
} as const;
