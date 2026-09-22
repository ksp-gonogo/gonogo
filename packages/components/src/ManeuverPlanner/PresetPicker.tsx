import { Select } from "@ksp-gonogo/ui-kit";
import { PRESETS, type PresetId } from "./presets";

interface PresetPickerProps {
  value: PresetId;
  onChange: (next: PresetId) => void;
}

export function PresetPicker({ value, onChange }: PresetPickerProps) {
  return (
    <Select
      aria-label="Maneuver preset"
      value={value}
      onChange={(e) => onChange(e.target.value as PresetId)}
    >
      {PRESETS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}
