import styled from "styled-components";

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
  return (
    <InputRow>
      <InputLabel>{label}</InputLabel>
      <InputField
        type="number"
        value={value}
        step={1}
        onChange={(e) => {
          const n = Number.parseFloat(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
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
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const InputField = styled.input`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-xs);
  text-align: right;
`;

const InputSuffix = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
`;
