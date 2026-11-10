import { ScreenProvider, useDataSources, useScreen } from "@ksp-gonogo/core";
import {
  SerialDeviceProvider,
  useSerialAggregateStatus,
  useSerialDeviceService,
} from "@ksp-gonogo/serial";
import { Fab, SettingsIcon, useModal } from "@ksp-gonogo/ui";
import { type ReactNode, useEffect } from "react";
import styled from "styled-components";
import { requestFirstRunSetup } from "../firstRun/firstRunRequest";
import {
  StationIdentityProvider,
  type StationIdentityService,
  useStationIdentityServiceOptional,
} from "../stationIdentity";
import { ModalTelemetryBridge } from "../telemetry/ModalTelemetryBridge";
import {
  type JoinedGame,
  JoinedGameProvider,
  useJoinedGame,
} from "./JoinedGameContext";
import { SettingsProvider, useSettingsService } from "./SettingsContext";
import { SettingsModal } from "./SettingsModal";
import { onSettingsRequested } from "./settingsRequest";

/**
 * Settings FAB: the modal portal renders outside this provider tree, so we
 * capture the services here at the call site and re-wrap inside the modal,
 * including `ModalTelemetryBridge`, which re-provides the live Sitrep
 * telemetry context every Uplink page's health report reads.
 *
 * The connection and serial devices are managed inside the Settings modal, so
 * this one button carries the aggregate "something in here needs attention"
 * badge: an offline data source or a dropped serial device lights it,
 * mirroring the per-tab dots.
 */
export function SettingsFab({ bottom = 384 }: { bottom?: number } = {}) {
  const { open, close } = useModal();
  const service = useSettingsService();
  const serialService = useSerialDeviceService();
  const screen = useScreen();
  const joined = useJoinedGame();
  const identity = useStationIdentityServiceOptional();

  // Data sources surface in Settings on every screen that holds its own
  // telemetry session, so badge for them there and not on a station. Serial
  // devices are per-screen, so badge on all of them.
  const sources = useDataSources();
  const dataSourceIssue =
    screen !== "station" &&
    !joined &&
    sources.some((s) => s.status === "disconnected" || s.status === "error");
  const serialStatus = useSerialAggregateStatus();
  const serialIssue = serialStatus === "partial" || serialStatus === "error";
  const hasIssue = dataSourceIssue || serialIssue;

  function openSettings(initialTabId?: string) {
    let modalId = "";
    // Settings closes before the setup opens: two aria-modal dialogs must never be up at once.
    const runSetupAgain = () => {
      close(modalId);
      requestFirstRunSetup();
    };
    modalId = open(
      <ModalTelemetryBridge>
        <SettingsProvider service={service}>
          <ScreenProvider value={screen}>
            <SerialDeviceProvider service={serialService}>
              <JoinedGameProviderOrPassthrough game={joined}>
                <IdentityOrPassthrough service={identity}>
                  <SettingsModal
                    initialTabId={initialTabId}
                    onRunSetupAgain={joined ? undefined : runSetupAgain}
                    joined={joined}
                  />
                </IdentityOrPassthrough>
              </JoinedGameProviderOrPassthrough>
            </SerialDeviceProvider>
          </ScreenProvider>
        </SettingsProvider>
      </ModalTelemetryBridge>,
      { title: "Settings" },
    );
  }

  useEffect(() => onSettingsRequested(openSettings));

  return (
    <Fab
      bottom={bottom}
      onClick={() => openSettings()}
      aria-label={
        hasIssue ? "Settings (something needs attention)" : "Settings"
      }
    >
      <SettingsIcon />
      {hasIssue && <StatusDot aria-hidden="true" />}
    </Fab>
  );
}

function IdentityOrPassthrough({
  service,
  children,
}: {
  service: StationIdentityService | null;
  children: ReactNode;
}) {
  if (!service) return <>{children}</>;
  return (
    <StationIdentityProvider service={service}>
      {children}
    </StationIdentityProvider>
  );
}

function JoinedGameProviderOrPassthrough({
  game,
  children,
}: {
  game: JoinedGame | null;
  children: ReactNode;
}) {
  if (!game) return <>{children}</>;
  return <JoinedGameProvider game={game}>{children}</JoinedGameProvider>;
}

const StatusDot = styled.span`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-circle);
  background: var(--color-warn-mark);
  border: 2px solid var(--color-surface-raised);
  pointer-events: none;
`;
