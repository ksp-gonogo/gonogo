import type { DataKey } from "@gonogo/core";
import { DataKeyPicker, GhostButton, PrimaryButton } from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import { THRESHOLD_OPS, type ThresholdOp } from "./triggerTypes";

interface TriggerEditorProps {
  open: boolean;
  numericKeys: DataKey[];
  /** True when arming would no-op for reasons external to the editor — kept
   *  on the prop so the editor doesn't need to know which (Principia /
   *  no plan / etc.). The "no key" / "non-finite value" cases are handled
   *  internally. */
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
    <Editor>
      <EditorTitle>When this condition holds</EditorTitle>
      <Field>
        <FieldLabel>Telemetry key</FieldLabel>
        <DataKeyPicker
          keys={numericKeys}
          value={triggerKey}
          onChange={setTriggerKey}
          placeholder="Search telemetry…"
          clearable
        />
      </Field>
      <OpRow>
        <Field>
          <FieldLabel htmlFor="mnv-trigger-op">Operator</FieldLabel>
          <OpSelect
            id="mnv-trigger-op"
            value={triggerOp}
            onChange={(e) => setTriggerOp(e.target.value as ThresholdOp)}
          >
            {THRESHOLD_OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </OpSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="mnv-trigger-value">Value</FieldLabel>
          <ValueInput
            id="mnv-trigger-value"
            type="number"
            step="any"
            value={triggerValueDraft}
            onChange={(e) => setTriggerValueDraft(e.target.value)}
          />
        </Field>
      </OpRow>
      <Actions>
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
      </Actions>
    </Editor>
  );
}

const Editor = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
`;

const EditorTitle = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
`;

const FieldLabel = styled.label`
  font-size: 11px;
  color: var(--color-text-faint);
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const OpRow = styled.div`
  display: flex;
  gap: 6px;
`;

const OpSelect = styled.select`
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
  padding: 3px 4px;
  font-size: 13px;
`;

const ValueInput = styled.input`
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
  padding: 3px 6px;
  font-size: 13px;
  font-family: inherit;
  width: 100%;
  min-width: 0;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
`;
