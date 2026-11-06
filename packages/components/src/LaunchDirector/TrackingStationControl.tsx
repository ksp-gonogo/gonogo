import { Button, type CommandButtonHandle } from "@ksp-gonogo/ui-kit";
import { type LaunchDirectorActionId, useBoundPress } from "./actions";

/**
 * A scene exit: the mod saves first and refuses when KSP will not, so the
 * control names the refusal. Serves the Tracking Station and the Space Center,
 * which leave the same way.
 */
export function TrackingStationControl({
  handle,
  label = "Tracking Station",
  commandLabel = "Go to Tracking Station",
  bindAs = "tracking-station",
}: {
  handle: CommandButtonHandle;
  label?: string;
  commandLabel?: string;
  bindAs?: LaunchDirectorActionId;
}) {
  const onPressReady = useBoundPress(bindAs);
  return (
    <Button
      command={handle.with(undefined, { label: commandLabel })}
      variant="ghost"
      confirmLabel="Confirm: save and leave"
      confirmTone="warn"
      onPressReady={onPressReady}
      tip={`${label}: saves the game first, and refuses if KSP will not save here`}
    >
      {label}
    </Button>
  );
}
