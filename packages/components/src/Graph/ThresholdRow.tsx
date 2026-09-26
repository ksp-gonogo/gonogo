import { Input, Select } from "@ksp-gonogo/ui";
import { IconButton } from "@ksp-gonogo/ui-kit";
import { REMOVE_BUTTON, ROW } from "./rowStyles";
import type { GraphThresholdConfig } from "./types";

interface Props {
  threshold: GraphThresholdConfig;
  onUpdate: (id: string, patch: Partial<GraphThresholdConfig>) => void;
  onRemove: (id: string) => void;
}

/** One threshold line: its label, value and which Y axis it draws against. */
export function ThresholdRow({ threshold, onUpdate, onRemove }: Props) {
  return (
    <div style={ROW}>
      <Input
        type="text"
        placeholder="Label"
        value={threshold.label ?? ""}
        onChange={(e) => onUpdate(threshold.id, { label: e.target.value })}
      />
      <Input
        type="number"
        placeholder="value"
        value={Number.isFinite(threshold.value) ? String(threshold.value) : ""}
        onChange={(e) =>
          onUpdate(threshold.id, { value: Number.parseFloat(e.target.value) })
        }
      />
      <Select
        value={threshold.axis}
        onChange={(e) =>
          onUpdate(threshold.id, {
            axis: e.target.value as "primary" | "secondary",
          })
        }
      >
        <option value="primary">Primary</option>
        <option value="secondary">Secondary</option>
      </Select>
      <IconButton
        type="button"
        onClick={() => onRemove(threshold.id)}
        style={REMOVE_BUTTON}
      >
        ×
      </IconButton>
    </div>
  );
}
