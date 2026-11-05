import { Input, Select } from "@ksp-gonogo/ui";
import { IconButton } from "@ksp-gonogo/ui-kit";
import { REMOVE_BUTTON, ROW } from "./rowStyles";
import type { GraphThresholdConfig } from "./types";

/** A threshold line as the form holds it: the value is absent until a number is entered. */
export type ThresholdDraft = Omit<GraphThresholdConfig, "value"> & {
  value: number | undefined;
};

interface Props {
  threshold: ThresholdDraft;
  onUpdate: (id: string, patch: Partial<ThresholdDraft>) => void;
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
        aria-label="Value"
        value={
          threshold.value !== undefined && Number.isFinite(threshold.value)
            ? String(threshold.value)
            : ""
        }
        onChange={(e) => {
          const parsed = Number.parseFloat(e.target.value);
          onUpdate(threshold.id, {
            value: Number.isFinite(parsed) ? parsed : undefined,
          });
        }}
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
        aria-label={`Remove threshold ${threshold.label || ""}`.trim()}
        onClick={() => onRemove(threshold.id)}
        style={REMOVE_BUTTON}
      >
        ×
      </IconButton>
    </div>
  );
}
