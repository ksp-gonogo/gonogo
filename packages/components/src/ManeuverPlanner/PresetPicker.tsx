import styled from "styled-components";
import { PRESETS, type PresetId } from "./presets";

interface PresetPickerProps {
  value: PresetId;
  onChange: (next: PresetId) => void;
}

export function PresetPicker({ value, onChange }: PresetPickerProps) {
  return (
    <PresetSelect
      aria-label="Maneuver preset"
      value={value}
      onChange={(e) => onChange(e.target.value as PresetId)}
    >
      {PRESETS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </PresetSelect>
  );
}

const PresetSelect = styled.select`
  width: 100%;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-xs);
`;
