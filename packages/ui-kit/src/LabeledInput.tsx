import { useEffect, useState } from "react";
import styled from "styled-components";
import { focusRing } from "./focusRing";

/**
 * A number with a name and a unit beside it, laid out so a column of them lines
 * up on the label, the field and the suffix.
 *
 * <p>The field is right-aligned because these are read as a column of
 * magnitudes, and a column of numbers that agree on their last digit is one an
 * operator can compare at a glance.</p>
 */
export interface LabeledInputProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  suffix?: string;
}

export function LabeledInput({
  label,
  value,
  onChange,
  suffix = "m/s",
}: LabeledInputProps) {
  /*
   * The text being typed, held apart from `value` so the field can be emptied
   * and retyped: only an entry that parses reaches `onChange`, and a new
   * `value` from outside replaces the draft.
   */
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((current) =>
      Number.parseFloat(current) === value ? current : String(value),
    );
  }, [value]);
  return (
    <InputRow>
      <InputLabel>{label}</InputLabel>
      <InputField
        type="number"
        value={draft}
        step={1}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number.parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      <InputSuffix>{suffix}</InputSuffix>
    </InputRow>
  );
}

const InputRow = styled.label`
  display: grid;
  grid-template-columns: 5em 1fr 2.5em;
  align-items: center;
  gap: var(--space-8);
`;

const InputLabel = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const InputField = styled.input`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  font-size: var(--font-size-value);
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-regular);
  text-align: right;

  ${focusRing}
`;

const InputSuffix = styled.span`
  font-size: var(--font-size-value);
  color: var(--color-text-faint);
`;
