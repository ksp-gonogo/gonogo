import type { ConfigComponentProps } from "@ksp-gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  PrimaryButton,
  Switch,
} from "@ksp-gonogo/ui";
import { useState } from "react";
import type { CameraFeedConfig } from "./CameraFeed";

/**
 * Settings-tab config UI for the Camera Feed widget. Rendered by the dashboard
 * gear modal (alongside the Inputs tab, since the widget also has actions).
 *
 * Only `showDebugInfo` is editable here — `flightId` is driven by the in-widget
 * camera picker, so we thread the incoming `flightId` straight back through
 * `onSave` to avoid the save wiping the current camera selection.
 */
export function CameraFeedConfigPanel({
  config,
  onSave,
}: Readonly<ConfigComponentProps<CameraFeedConfig>>) {
  const [showDebugInfo, setShowDebugInfo] = useState(
    config?.showDebugInfo ?? false,
  );
  return (
    <ConfigForm>
      <Field>
        <Switch
          checked={showDebugInfo}
          onChange={setShowDebugInfo}
          label="Show debug info"
        />
        <FieldHint>
          Overlays the live resolution, bitrate and adaptive-quality readout on
          the feed. Off by default to keep the picture clean.
        </FieldHint>
      </Field>
      <PrimaryButton
        onClick={() =>
          onSave({ flightId: config?.flightId ?? null, showDebugInfo })
        }
      >
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}
