import { Input, Select } from "@ksp-gonogo/ui";
import { IconButton } from "@ksp-gonogo/ui-kit";
import { REMOVE_BUTTON, ROW } from "./rowStyles";
import type { GraphThresholdConfig } from "./types";

interface Props {
  threshold: GraphThresholdConfig;
  onUpdate: (id: string, patch: Partial<GraphThresholdConfig>) => void;
  onRemove: (id: string) => void;
}

/** What each choice in the kind picker saves: a limit is saved with the side that is past it. */
const KINDS: Record<string, Pick<GraphThresholdConfig, "kind" | "bad">> = {
  "limit-above": { kind: "limit", bad: "above" },
  "limit-below": { kind: "limit", bad: "below" },
  target: { kind: "target", bad: undefined },
};

/** One threshold line: its label, value, which Y axis it draws against and what kind of line it is. */
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
      <Select
        aria-label="Kind"
        value={
          threshold.kind === "target"
            ? "target"
            : `limit-${threshold.bad ?? "above"}`
        }
        onChange={(e) => onUpdate(threshold.id, KINDS[e.target.value])}
      >
        <option value="limit-above">Upper limit</option>
        <option value="limit-below">Lower limit</option>
        <option value="target">Target</option>
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
