import type { ConfigComponentProps } from "@ksp-gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Select,
  Switch,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import type { DockingHudMode, TargetingConfig } from "./config";

export function TargetingConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<TargetingConfig>>) {
  const [autoSwitch, setAutoSwitch] = useState(config?.autoSwitch !== false);
  const [hudMode, setHudMode] = useState<DockingHudMode>(
    config?.hudMode ?? "hud-with-camera",
  );
  // No camera picker: the augment filling `targeting.camera` picks, and a pinned id round-trips as an override.
  const pinnedCameraId = config?.cameraFlightId;

  const candidate = useMemo<TargetingConfig>(
    () => ({
      autoSwitch,
      hudMode,
      cameraFlightId: pinnedCameraId ?? undefined,
    }),
    [autoSwitch, hudMode, pinnedCameraId],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <Switch
          checked={autoSwitch}
          onChange={setAutoSwitch}
          label="Auto-switch to docking HUD under 100 m"
        />
        <FieldHint>
          Triggers only when the target is a vessel or docking port, not a
          celestial body.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel htmlFor="dtt-hud-mode">HUD variant</FieldLabel>
        <Select
          id="dtt-hud-mode"
          value={hudMode}
          onChange={(e) => setHudMode(e.target.value as DockingHudMode)}
        >
          <option value="hud-with-camera">HUD over camera stream</option>
          <option value="hud">HUD only (no video)</option>
        </Select>
        <FieldHint>
          The camera view needs a camera mod installed. Its docking camera is
          picked automatically for the backdrop.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}
