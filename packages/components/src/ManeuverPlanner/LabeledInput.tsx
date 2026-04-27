import styled from "styled-components";

interface LabeledInputProps {
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
  gap: 8px;
`;

const InputLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const InputField = styled.input`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 2px;
  text-align: right;
`;

const InputSuffix = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
`;
