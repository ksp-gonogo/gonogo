import type { ConfigComponentProps } from "@ksp-gonogo/core";
import { useTelemetry } from "@ksp-gonogo/core";
import { delayVisibility, value } from "@ksp-gonogo/sitrep-sdk";
import {
  ConfigForm,
  Field,
  FieldHint,
  Switch,
  Unit,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { ALARM_REQUIRED_ABOVE_SECONDS, type WarpControlConfig } from "./config";

export function WarpControlConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<WarpControlConfig>>) {
  const delayReading = useTelemetry("comms.delay");
  /*
   * The setting governs warping under a delay, so it is left out while the
   * craft is known to have none. Any other state keeps it: an unreported delay
   * is not a delay of zero.
   */
  const noDelay =
    delayReading.state === "observed" &&
    delayVisibility(delayReading.value.oneWaySeconds) === "hidden";
  const [requireAlarm, setRequireAlarm] = useState(
    config?.requireAlarmUnderDelay !== false,
  );
  const candidate = useMemo<WarpControlConfig>(
    () => ({ requireAlarmUnderDelay: requireAlarm }),
    [requireAlarm],
  );
  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });
  if (noDelay) return <ConfigForm>{null}</ConfigForm>;
  return (
    <ConfigForm>
      <Field>
        <Switch
          checked={requireAlarm}
          onChange={setRequireAlarm}
          label="Require an alarm to warp under delay"
        />
        <FieldHint>
          Above <Unit value={value("s", ALARM_REQUIRED_ABOVE_SECONDS)} /> to
          command
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}
