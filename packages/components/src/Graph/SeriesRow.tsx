import type { DataKeyMeta } from "@ksp-gonogo/data";
import { DataKeyPicker, Select } from "@ksp-gonogo/ui";
import { IconButton } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { REMOVE_BUTTON, ROW } from "./rowStyles";
import type { GraphSeriesConfig } from "./types";

interface Props {
  series: GraphSeriesConfig;
  numericKeys: DataKeyMeta[];
  onUpdate: (id: string, patch: Partial<GraphSeriesConfig>) => void;
  onRemove: (id: string) => void;
}

/** One configured series: its key, render style and axis, plus the upper-bound picker a band adds. */
export function SeriesRow({ series, numericKeys, onUpdate, onRemove }: Props) {
  return (
    <div style={SERIES_GROUP}>
      <div style={WRAPPING_ROW}>
        <div style={KEY_LINE}>
          <DataKeyPicker
            keys={numericKeys}
            value={series.key || null}
            onChange={(k) => onUpdate(series.id, { key: k ?? "" })}
            placeholder={
              series.type === "band" ? "Pick lower bound..." : "Pick a key..."
            }
            clearable
          />
          <IconButton
            type="button"
            aria-label={`Remove series ${series.label || series.key}`.trim()}
            onClick={() => onRemove(series.id)}
            style={REMOVE_BUTTON}
          >
            ×
          </IconButton>
        </div>
        <Select
          aria-label="Series style"
          style={CHOICE}
          value={series.type ?? "line"}
          onChange={(e) =>
            onUpdate(series.id, {
              type: e.target.value as GraphSeriesConfig["type"],
            })
          }
        >
          <option value="line">Line</option>
          <option value="step">Step</option>
          <option value="scatter">Scatter</option>
          <option value="band">Band</option>
        </Select>
        <Select
          aria-label="Series axis"
          style={CHOICE}
          value={series.axis}
          onChange={(e) =>
            onUpdate(series.id, {
              axis: e.target.value as GraphSeriesConfig["axis"],
            })
          }
        >
          <option value="auto">Auto axis</option>
          <option value="primary">Primary (left)</option>
          <option value="secondary">Secondary (right)</option>
        </Select>
      </div>
      {series.type === "band" && (
        <div style={ROW}>
          <DataKeyPicker
            keys={numericKeys}
            value={series.keyHigh ?? null}
            onChange={(k) => onUpdate(series.id, { keyHigh: k ?? "" })}
            placeholder="Pick upper bound..."
            clearable
          />
        </div>
      )}
    </div>
  );
}

/**
 * The key and its remove control take a line of their own, and each choice
 * takes half of the next line while two fit and a line apiece when they do not,
 * so no control is squeezed below a readable width in a narrow settings panel.
 */
const WRAPPING_ROW: CSSProperties = { ...ROW, flexWrap: "wrap" };

const KEY_LINE: CSSProperties = {
  ...ROW,
  flex: "1 1 100%",
  marginBottom: 0,
};

const CHOICE: CSSProperties = { flex: "1 1 12rem", minWidth: 0, width: "auto" };

const SERIES_GROUP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  marginBottom: "var(--gap-config-group)",
};
