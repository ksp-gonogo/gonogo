import {
  type CommandButtonHandle,
  commandLossSentence,
  Spinner,
  useCommandButton,
} from "@ksp-gonogo/ui-kit";
import { useBindPress } from "./actions";
import { TrackingStationButton, TrackingStationConfirm } from "./styles";

const TRACKING_STATION_LABEL = "Go to Tracking Station";

function confirmText(isRefused: boolean, isLost: boolean): string {
  if (isRefused) return "Refused";
  if (isLost) return "No reply";
  return "Confirm: save and leave";
}

/** The mod saves first and refuses when KSP will not, so this control keeps its own chrome to name the refusal. */
export function TrackingStationControl({
  handle,
}: {
  handle: CommandButtonHandle;
}) {
  const trackingStation = useCommandButton({
    handle,
    commandLabel: TRACKING_STATION_LABEL,
  });
  useBindPress(
    "trackingStation",
    trackingStation.press,
    !trackingStation.isPending,
  );
  const loss = commandLossSentence({ label: TRACKING_STATION_LABEL });

  if (trackingStation.isPending) {
    return (
      <TrackingStationConfirm type="button" disabled aria-busy="true">
        <Spinner size={12} /> Leaving...
      </TrackingStationConfirm>
    );
  }
  const { isArmed, isRefused, isLost, refusalText } = trackingStation;
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
      title="Tracking Station: saves the game first, and refuses if KSP will not save here"
    >
      Tracking Station
    </TrackingStationButton>
  );
}
