import { ScreenProvider } from "@ksp-gonogo/core";
import {
  SerialDeviceProvider,
  type SerialDeviceService,
} from "@ksp-gonogo/serial";
import { useModal } from "@ksp-gonogo/ui";
import { useEffect, useRef } from "react";
import type { AnalyticsConsentService } from "../analytics/AnalyticsConsentService";
import { ModalTelemetryBridge } from "../telemetry/ModalTelemetryBridge";
import { hasSeenFirstRunSetup, markFirstRunSetupSeen } from "./firstRunSetup";
import { SettingsProvider } from "./SettingsContext";
import { SettingsModal } from "./SettingsModal";
import type { SettingsService } from "./SettingsService";

/**
 * First-run auto-open host. Mounted on the MAIN screen only, alongside
 * `AnalyticsConsentHost`: a station never talks to the mod directly (see
 * `SettingsModal`'s own `showDataSources` gate), so there is nothing for a
 * station to auto-open.
 *
 * Opens the Settings modal pre-selected to the Data Sources tab, which is
 * where an operator connects to their running mod and reads back what it
 * reports. The `gonogo.uplinkHubWizard.firstRunSeen` flag is written the
 * instant the modal opens (not on completion) so the "never re-opens once
 * dismissed" guarantee holds even if the operator closes it immediately.
 *
 * Renders nothing itself, it's a pure side-effect component, same shape as
 * `AnalyticsConsentHost` minus that component's own modal (this one reuses
 * `SettingsModal` via `useModal().open`, `AnalyticsConsentHost` renders its
 * modal inline).
 *
 * Held behind the analytics consent gate. Both auto-open on the same first
 * boot, and before this they did so simultaneously: two `aria-modal="true"`
 * dialogs reachable at once, which the WCAG dialog pattern rules out and which
 * left a keyboard operator tabbing through a panel stacked under a blocking ask
 * they could not reach. Deferring this half is the right one to move, because
 * consent is the gate the app will not proceed past. It also saves the one
 * auto-open the operator ever gets: the first-run flag is written the instant
 * the modal opens, so opening behind a backdrop would have spent it on a panel
 * they never saw.
 *
 * The modal portal renders as a sibling of `<App/>` under `ModalProvider`
 * (mounted above `MainScreen` in `main.tsx`), not nested inside this
 * component's own provider tree: so the content passed to `open()` must
 * re-wrap `SettingsProvider`/`ScreenProvider`/`SerialDeviceProvider`
 * itself, exactly like `SettingsFab`'s `handleClick` already does. Also
 * wraps `ModalTelemetryBridge` so the Data Sources tab's live
 * `system.uplinkHealth` read actually sees data; see that component's own doc
 * comment for why the portal doesn't inherit it automatically.
 */
export function FirstRunSetupHost({
  settingsService,
  serialService,
  analyticsConsent,
}: Readonly<{
  settingsService: SettingsService;
  serialService: SerialDeviceService;
  analyticsConsent: AnalyticsConsentService;
}>) {
  const { open } = useModal();
  const openedRef = useRef(false);

  useEffect(() => {
    const openIfClear = () => {
      if (openedRef.current) return;
      if (!analyticsConsent.hasAnswered()) return;
      if (hasSeenFirstRunSetup()) return;
      openedRef.current = true;
      markFirstRunSetupSeen();
      open(
        <ModalTelemetryBridge>
          <SettingsProvider service={settingsService}>
            <ScreenProvider value="main">
              <SerialDeviceProvider service={serialService}>
                <SettingsModal initialTabId="data-sources" />
              </SerialDeviceProvider>
            </ScreenProvider>
          </SettingsProvider>
        </ModalTelemetryBridge>,
        { title: "Settings" },
      );
    };

    openIfClear();
    // The operator answering the consent ask is what clears the way, so watch
    // for it rather than leaving this unopened for the whole session.
    return analyticsConsent.subscribe(openIfClear);
  }, [open, settingsService, serialService, analyticsConsent]);

  return null;
}
