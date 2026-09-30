import type { Reading, TargetListEntry, Value } from "@ksp-gonogo/sitrep-sdk";
import type { CommandButtonHandle } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { ArmedButton } from "./ArmedButton";
import { Altitude, formatMissionTime } from "./flightFigures";
import {
  CrashChip,
  FlightStatRow,
  FlightStats,
  InFlightWrap,
  PadActions,
  StatLabel,
  StatValue,
  TrackingStationButton,
} from "./styles";
import { TrackingStationControl } from "./TrackingStationControl";
import { VesselSwitchList } from "./VesselSwitchList";

export function InFlightPanel({
  missionTime,
  altitudeMeters,
  crashInProgress,
  availableVessels,
  distanceOf,
  recoverCmd,
  revertLaunchCmd,
  revertEditorCmd,
  toTrackingCmd,
  switchCmd,
}: {
  missionTime: number | null;
  altitudeMeters: number | null;
  crashInProgress: boolean;
  availableVessels: TargetListEntry[] | undefined;
  distanceOf: (entry: TargetListEntry) => Reading<Value<"m">> | undefined;
  /** The handles: each control holds its own arm and in-flight state off the one it is given. */
  recoverCmd: CommandButtonHandle;
  revertLaunchCmd: CommandButtonHandle;
  revertEditorCmd: CommandButtonHandle;
  toTrackingCmd: CommandButtonHandle;
  switchCmd: CommandButtonHandle;
}) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const [showSpaceObjects, setShowSpaceObjects] = useState(false);
  const totalAvailable = availableVessels?.length ?? 0;
  return (
    <InFlightWrap>
      {crashInProgress && (
        <CrashChip role="status">Crash in progress</CrashChip>
      )}
      <FlightStats>
        <FlightStatRow>
          <StatLabel>Mission time</StatLabel>
          <StatValue>{formatMissionTime(missionTime)}</StatValue>
        </FlightStatRow>
        <FlightStatRow>
          <StatLabel>Altitude</StatLabel>
          <StatValue>{<Altitude m={altitudeMeters} />}</StatValue>
        </FlightStatRow>
      </FlightStats>
      <PadActions>
        <ArmedButton
          bindAs="recover"
          kind="recover"
          handle={recoverCmd}
          commandLabel="Recover"
          label="Recover"
          confirmLabel="Confirm recover"
          pendingLabel="Recovering..."
        />
        <ArmedButton
          bindAs="revertToLaunch"
          kind="revert"
          handle={revertLaunchCmd}
          commandLabel="Revert to launch"
          label="Revert to launch"
          confirmLabel="Confirm revert to launch"
          pendingLabel="Reverting..."
        />
        <ArmedButton
          bindAs="revertToEditor"
          kind="revert"
          handle={revertEditorCmd}
          args={{ editor: "vab" }}
          commandLabel="Revert to VAB"
          label="Revert to VAB"
          confirmLabel="Confirm revert to VAB"
          pendingLabel="Reverting..."
        />
        <TrackingStationControl handle={toTrackingCmd} />
        <TrackingStationButton
          type="button"
          disabled={totalAvailable === 0}
          aria-expanded={switchOpen}
          aria-haspopup="listbox"
          onClick={() => setSwitchOpen((v) => !v)}
          title={
            totalAvailable === 0
              ? "No other vessels in this save"
              : `Switch to one of ${totalAvailable} other vessel${totalAvailable === 1 ? "" : "s"}`
          }
        >
          Switch to vessel ▾
        </TrackingStationButton>
      </PadActions>
      {switchOpen && availableVessels && totalAvailable > 0 && (
        <VesselSwitchList
          vessels={availableVessels}
          distanceOf={distanceOf}
          showSpaceObjects={showSpaceObjects}
          onToggleSpaceObjects={() => setShowSpaceObjects((v) => !v)}
          onSwitch={(vesselId) => {
            setSwitchOpen(false);
            void switchCmd.send({ vesselId });
          }}
        />
      )}
    </InFlightWrap>
  );
}
