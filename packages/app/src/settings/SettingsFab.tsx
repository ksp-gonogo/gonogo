import { ScreenProvider, useDataSources, useScreen } from "@ksp-gonogo/core";
import {
  SerialDeviceProvider,
  useSerialAggregateStatus,
  useSerialDeviceService,
} from "@ksp-gonogo/serial";
import { Fab, SettingsIcon, useModal } from "@ksp-gonogo/ui";
import styled from "styled-components";
import { ModalTelemetryBridge } from "../telemetry/ModalTelemetryBridge";
import { useUplinkGap } from "../wizard/useUplinkGap";
import { SettingsProvider, useSettingsService } from "./SettingsContext";
import { SettingsModal } from "./SettingsModal";

/**
 * Settings FAB — the modal portal renders outside this provider tree, so we
 * capture the services here at the call site and re-wrap inside the modal —
 * including `ModalTelemetryBridge`, which re-provides the live Sitrep
 * telemetry context the Data Sources tab's `UplinkHealthList` and the
 * Uplink Hub tab both need (see that component's own doc comment for why
 * the modal portal doesn't inherit it automatically).
 *
 * Data-source management and serial-device management now live inside the
 * Settings modal (they used to be their own FABs), so this button carries
 * the aggregate "something in here needs attention" badge: an offline data
 * source or a dropped serial device lights it, mirroring the per-tab dots.
 */
export function SettingsFab({ bottom = 384 }: { bottom?: number } = {}) {
  const { open } = useModal();
  const service = useSettingsService();
  const serialService = useSerialDeviceService();
  const screen = useScreen();

  // Data sources only surface in Settings on the main screen, so only badge
  // for them there. Serial devices are per-screen, so badge on both.
  const sources = useDataSources();
  const dataSourceIssue =
    screen === "main" &&
    sources.some((s) => s.status === "disconnected" || s.status === "error");
  const serialStatus = useSerialAggregateStatus();
  const serialIssue = serialStatus === "partial" || serialStatus === "error";
  // Loading an Uplink client is main-screen-only (same gate as Data Sources
  // above), so only badge the aggregate FAB for it there. See useUplinkGap's
  // own doc comment for the "load-from-hub" state (installed, available, a
  // Hub descriptor exists, not loaded yet) that this counts as actionable.
  const { entries: uplinkGapEntries } = useUplinkGap();
  const uplinkHubIssue =
    screen === "main" &&
    uplinkGapEntries.some((entry) => entry.state === "load-from-hub");
  const hasIssue = dataSourceIssue || serialIssue || uplinkHubIssue;

  function handleClick() {
    open(
      <ModalTelemetryBridge>
        <SettingsProvider service={service}>
          <ScreenProvider value={screen}>
            <SerialDeviceProvider service={serialService}>
              <SettingsModal />
            </SerialDeviceProvider>
          </ScreenProvider>
        </SettingsProvider>
      </ModalTelemetryBridge>,
      { title: "Settings" },
    );
  }

  return (
    <Fab
      bottom={bottom}
      onClick={handleClick}
      aria-label={
        hasIssue ? "Settings (something needs attention)" : "Settings"
      }
      title={hasIssue ? "Something in settings needs attention" : "Settings"}
    >
      <SettingsIcon />
      {hasIssue && <StatusDot aria-hidden="true" />}
    </Fab>
  );
}

const StatusDot = styled.span`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-status-warning-bg);
  border: 2px solid var(--color-surface-raised);
  pointer-events: none;
`;
