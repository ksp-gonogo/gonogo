import type { ConfigComponentProps } from "@ksp-gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Select,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import {
  DELTA_V_MODE_LABELS,
  type DeltaVMode,
  type FuelStatusConfig,
} from "./config";

export function FuelStatusConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<FuelStatusConfig>>) {
  const [mode, setMode] = useState<DeltaVMode>(config?.deltaVMode ?? "actual");

  const candidate = useMemo<FuelStatusConfig>(
    () => ({ deltaVMode: mode }),
    [mode],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="fuel-dv-mode">ΔV reference</FieldLabel>
        <Select
          id="fuel-dv-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as DeltaVMode)}
        >
          <option value="actual">{DELTA_V_MODE_LABELS.actual}</option>
          <option value="vac">{DELTA_V_MODE_LABELS.vac}</option>
          <option value="asl">{DELTA_V_MODE_LABELS.asl}</option>
        </Select>
        <FieldHint>
          "Current atmosphere" matches live conditions: what you'll actually
          burn. Switch to vacuum for planning headroom.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}
