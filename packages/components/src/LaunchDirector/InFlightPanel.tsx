import type { TargetListEntry } from "@ksp-gonogo/sitrep-sdk";
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
  canRevertToLaunch,
  canRevertToEditor,
  crashBlocked,
  availableVessels,
  recoverCmd,
  revertLaunchCmd,
  revertEditorCmd,
  toTrackingCmd,
  switchCmd,
}: {
  missionTime: number | null;
  altitudeMeters: number | null;
  canRevertToLaunch: boolean;
  canRevertToEditor: boolean;
  crashBlocked: boolean;
  availableVessels: TargetListEntry[] | undefined;
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
      {crashBlocked && (
        <CrashChip role="status">
          Crash in progress: return to Space Center to recover
        </CrashChip>
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
          disabled={crashBlocked}
        />
        <ArmedButton
          bindAs="revertToLaunch"
          kind="revert"
          handle={revertLaunchCmd}
          commandLabel="Revert to launch"
          label={
            canRevertToLaunch ? "Revert to launch" : "Revert to launch (n/a)"
          }
          confirmLabel="Confirm revert to launch"
          pendingLabel="Reverting..."
          disabled={!canRevertToLaunch}
        />
        <ArmedButton
          bindAs="revertToEditor"
          kind="revert"
          handle={revertEditorCmd}
          args={{ editor: "vab" }}
          commandLabel="Revert to VAB"
          label={canRevertToEditor ? "Revert to VAB" : "Revert to VAB (n/a)"}
          confirmLabel="Confirm revert to VAB"
          pendingLabel="Reverting..."
          disabled={!canRevertToEditor}
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
