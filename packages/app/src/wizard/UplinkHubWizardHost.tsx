import { ScreenProvider } from "@ksp-gonogo/core";
import {
  SerialDeviceProvider,
  type SerialDeviceService,
} from "@ksp-gonogo/serial";
import { useModal } from "@ksp-gonogo/ui";
import { useEffect, useRef } from "react";
import { SettingsProvider } from "../settings/SettingsContext";
import { SettingsModal } from "../settings/SettingsModal";
import type { SettingsService } from "../settings/SettingsService";
import { ModalTelemetryBridge } from "../telemetry/ModalTelemetryBridge";
import {
  hasSeenUplinkHubWizard,
  markUplinkHubWizardSeen,
} from "./wizardFirstRun";

/**
 * First-run auto-open host (design §1: "auto-opens once on first boot" —
 * explicitly deferred by Task C to this task). Mounted on the MAIN screen
 * only, alongside `AnalyticsConsentHost` — station screens never load
 * Uplink clients (see `SettingsModal`'s own `showDataSources` gate), so
 * there is nothing for a station to auto-open.
 *
 * Opens the Settings modal pre-selected to the "Uplink Hub" tab, rendering
 * `UplinkHubWizard` with `firstRun` so the Welcome/Done bookends appear. The
 * `gonogo.uplinkHubWizard.firstRunSeen` flag is written the instant the
 * modal opens (not on completion) so the "never re-opens once
 * dismissed/completed" guarantee holds even if the operator closes it
 * immediately.
 *
 * Renders nothing itself — it's a pure side-effect component, same shape as
 * `AnalyticsConsentHost` minus that component's own modal (this one reuses
 * `SettingsModal` via `useModal().open`, `AnalyticsConsentHost` renders its
 * modal inline).
 *
 * The modal portal renders as a sibling of `<App/>` under `ModalProvider`
 * (mounted above `MainScreen` in `main.tsx`), not nested inside this
 * component's own provider tree — so the content passed to `open()` must
 * re-wrap `SettingsProvider`/`ScreenProvider`/`SerialDeviceProvider`
 * itself, exactly like `SettingsFab`'s `handleClick` already does. Also
 * wraps `ModalTelemetryBridge` so the wizard's `useUplinkGap()` (which reads
 * the live `system.uplinkHealth` stream) actually sees data — see that
 * component's own doc comment for why the portal doesn't inherit it
 * automatically.
 */
export function UplinkHubWizardHost({
  settingsService,
  serialService,
}: Readonly<{
  settingsService: SettingsService;
  serialService: SerialDeviceService;
}>) {
  const { open, close } = useModal();
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    if (hasSeenUplinkHubWizard()) return;
    openedRef.current = true;
    markUplinkHubWizardSeen();

    let modalId = "";
    const handleFinish = () => close(modalId);
    modalId = open(
      <ModalTelemetryBridge>
        <SettingsProvider service={settingsService}>
          <ScreenProvider value="main">
            <SerialDeviceProvider service={serialService}>
              <SettingsModal
                initialTabId="uplink-hub"
                uplinkHubFirstRun
                onUplinkHubFinish={handleFinish}
              />
            </SerialDeviceProvider>
          </ScreenProvider>
        </SettingsProvider>
      </ModalTelemetryBridge>,
      { title: "Settings" },
    );
  }, [open, close, settingsService, serialService]);

  return null;
}
