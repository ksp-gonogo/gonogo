import {
  type CommandButtonHandle,
  commandLossSentence,
  Spinner,
  useCommandButton,
} from "@ksp-gonogo/ui-kit";
import { type LaunchDirectorActionId, useBindPress } from "./actions";
import { TrackingStationButton, TrackingStationConfirm } from "./styles";

function confirmText(isRefused: boolean, isLost: boolean): string {
  if (isRefused) return "Refused";
  if (isLost) return "No reply";
  return "Confirm: save and leave";
}

/**
 * A scene exit: the mod saves first and refuses when KSP will not, so this
 * control keeps its own chrome to name the refusal. Serves the Tracking Station
 * and the Space Center, which leave the same way.
 */
export function TrackingStationControl({
  handle,
  label = "Tracking Station",
  commandLabel = "Go to Tracking Station",
  bindAs = "trackingStation",
}: {
  handle: CommandButtonHandle;
  label?: string;
  commandLabel?: string;
  bindAs?: LaunchDirectorActionId;
}) {
  const trackingStation = useCommandButton({ handle, commandLabel });
  useBindPress(bindAs, trackingStation.press, !trackingStation.isPending);
  const loss = commandLossSentence({ label: commandLabel });

  if (trackingStation.isPending) {
    return (
      <TrackingStationConfirm type="button" disabled aria-busy="true">
        <Spinner size={12} /> Leaving...
      </TrackingStationConfirm>
    );
  }
  const {
    isArmed,
    isRefused,
    isLost,
    isBlocked,
    isShowingReason,
    refusalText,
  } = trackingStation;
  if (isBlocked) {
    // aria-disabled, not disabled, so a press can show the command's own reason.
    return (
      <TrackingStationButton
        type="button"
        onClick={() => trackingStation.press(true)}
        aria-disabled="true"
        aria-label={refusalText ?? undefined}
        title={refusalText ?? undefined}
        data-gate="blocked"
      >
        {isShowingReason ? refusalText : label}
      </TrackingStationButton>
    );
  }
  if (isArmed || isRefused || isLost) {
    const lossText = isLost ? loss : undefined;
    return (
      <TrackingStationConfirm
        type="button"
        onClick={() => trackingStation.press(true)}
        title={
          refusalText ??
          lossText ??
          "Saves the game, then leaves. Refused, naming KSP's own reason, when KSP will not save here."
        }
        aria-label={refusalText ?? lossText}
      >
        {confirmText(isRefused, isLost)}
      </TrackingStationConfirm>
    );
  }
  return (
    <TrackingStationButton
      type="button"
      onClick={() => trackingStation.press(true)}
      title={`${label}: saves the game first, and refuses if KSP will not save here`}
    >
      {label}
    </TrackingStationButton>
  );
}
