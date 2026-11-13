import type { Reading, SwitchableVessel, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Button,
  type CommandButtonHandle,
  Floating,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ArmedButton } from "./ArmedButton";
import { formatMissionTime } from "./flightFigures";
import { SaveControls } from "./SaveControls";
import {
  CrashChip,
  FlightStatRow,
  FlightStats,
  InFlightWrap,
  PadActions,
  StatLabel,
  StatValue,
} from "./styles";
import { TrackingStationControl } from "./TrackingStationControl";
import { VesselSwitchList } from "./VesselSwitchList";

export function InFlightPanel({
  missionTime,
  altitude,
  crashInProgress,
  noActiveVessel,
  crewOutside,
  availableVessels,
  distanceOf,
  recoverCmd,
  revertLaunchCmd,
  revertEditorCmd,
  toTrackingCmd,
  toSpaceCenterCmd,
  switchCmd,
  quicksaveCmd,
  quickloadCmd,
}: {
  missionTime: number | null;
  altitude: Reading<Value<"m">>;
  crashInProgress: boolean;
  /** The game has no vessel in this flight, so there is nothing to recover. */
  noActiveVessel: boolean;
  /** Crew of this vessel who are outside it, who a recovery would leave behind. */
  crewOutside: readonly string[];
  availableVessels: readonly SwitchableVessel[] | undefined;
  distanceOf: (entry: SwitchableVessel) => Reading<Value<"m">> | undefined;
  /** The handles: each control holds its own arm and in-flight state off the one it is given. */
  recoverCmd: CommandButtonHandle;
  revertLaunchCmd: CommandButtonHandle;
  revertEditorCmd: CommandButtonHandle;
  toTrackingCmd: CommandButtonHandle;
  toSpaceCenterCmd: CommandButtonHandle;
  switchCmd: CommandButtonHandle;
  quicksaveCmd: CommandButtonHandle;
  quickloadCmd: CommandButtonHandle;
}) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const [showSpaceObjects, setShowSpaceObjects] = useState(false);
  const switchTriggerRef = useRef<HTMLButtonElement>(null);
  const switchLayerRef = useRef<HTMLDivElement>(null);
  const switchListShown =
    switchOpen && availableVessels !== undefined && availableVessels.length > 0;
  useEffect(() => {
    if (!switchListShown) return;
    const close = () => setSwitchOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        switchLayerRef.current?.contains(target) ||
        switchTriggerRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      switchTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [switchListShown]);
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
          <StatValue>
            <Unit value={altitude} reckoned />
          </StatValue>
        </FlightStatRow>
      </FlightStats>
      {!noActiveVessel && crewOutside.length > 0 && (
        <div>
          <Badge tone="warn">{crewOutside.length} crew outside</Badge>
        </div>
      )}
      <PadActions>
        {!noActiveVessel && (
          <ArmedButton
            bindAs="recover"
            kind="recover"
            handle={recoverCmd}
            commandLabel="Recover"
            label="Recover"
            confirmLabel="Confirm recover"
          />
        )}
        <ArmedButton
          bindAs="revert-to-launch"
          kind="revert"
          handle={revertLaunchCmd}
          commandLabel="Revert to launch"
          label="Revert to launch"
          confirmLabel="Confirm revert to launch"
        />
        <ArmedButton
          bindAs="revert-to-editor"
          kind="revert"
          handle={revertEditorCmd}
          args={{ editor: "vab" }}
          commandLabel="Revert to VAB"
          label="Revert to VAB"
          confirmLabel="Confirm revert to VAB"
        />
        <TrackingStationControl handle={toTrackingCmd} />
        <TrackingStationControl
          handle={toSpaceCenterCmd}
          label="Space Center"
          commandLabel="Go to Space Center"
          bindAs="space-center"
        />
        <Tooltip
          text={
            totalAvailable === 0
              ? "No other vessels in this save"
              : `Switch to one of ${totalAvailable} other vessel${totalAvailable === 1 ? "" : "s"}`
          }
        >
          <Button
            ref={switchTriggerRef}
            type="button"
            variant="ghost"
            disabled={totalAvailable === 0}
            disabledReason="No other vessels in this save"
            aria-expanded={switchOpen}
            aria-haspopup="listbox"
            onClick={() => setSwitchOpen((v) => !v)}
          >
            Switch to vessel ▾
          </Button>
        </Tooltip>
      </PadActions>
      <SaveControls quicksaveCmd={quicksaveCmd} quickloadCmd={quickloadCmd} />
      {switchListShown && availableVessels && (
        <Floating
          anchor={() => {
            const box = switchTriggerRef.current?.getBoundingClientRect();
            return box ? { x: box.left, y: box.bottom } : null;
          }}
        >
          <div ref={switchLayerRef} style={SWITCH_LAYER}>
            <VesselSwitchList
              vessels={availableVessels}
              distanceOf={distanceOf}
              showSpaceObjects={showSpaceObjects}
              onToggleSpaceObjects={() => setShowSpaceObjects((v) => !v)}
              switchCommand={(vesselId, name) =>
                switchCmd.with({ vesselId }, { label: `Fly ${name}` })
              }
            />
          </div>
        </Floating>
      )}
    </InFlightWrap>
  );
}

const SWITCH_LAYER: CSSProperties = { width: "min(20rem, 90vw)" };
