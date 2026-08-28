import { ScreenProvider } from "@ksp-gonogo/core";
import {
  SerialDeviceProvider,
  type SerialDeviceService,
} from "@ksp-gonogo/serial";
import { useModal } from "@ksp-gonogo/ui";
import { useEffect, useRef } from "react";
import type { AnalyticsConsentService } from "../analytics/AnalyticsConsentService";
import { SettingsProvider } from "../settings/SettingsContext";
import { SettingsModal } from "../settings/SettingsModal";
import type { SettingsService } from "../settings/SettingsService";
import { ModalTelemetryBridge } from "../telemetry/ModalTelemetryBridge";
import {
  hasSeenUplinkHubWizard,
  markUplinkHubWizardSeen,
} from "./wizardFirstRun";

/**
 * First-run auto-open host (design §1: "auto-opens once on first boot",
 * explicitly deferred by Task C to this task). Mounted on the MAIN screen
 * only, alongside `AnalyticsConsentHost`: station screens never load
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
 * Renders nothing itself, it's a pure side-effect component, same shape as
 * `AnalyticsConsentHost` minus that component's own modal (this one reuses
 * `SettingsModal` via `useModal().open`, `AnalyticsConsentHost` renders its
 * modal inline).
 *
 * Held behind the analytics consent gate. Both auto-open on the same first
 * boot, and before this they did so simultaneously: two `aria-modal="true"`
 * dialogs reachable at once, which the WCAG dialog pattern rules out and which
 * left a keyboard operator tabbing through a wizard stacked under a blocking
 * ask they could not reach. Deferring the wizard is the right half to move,
 * because consent is the gate the app will not proceed past and the wizard is a
 * multi-step flow the operator should meet with nothing on top of it. It also
 * saves the one auto-open the operator ever gets: the first-run flag is written
 * the instant the modal opens, so opening behind a backdrop would have spent it
 * on a wizard they never saw.
 *
 * The modal portal renders as a sibling of `<App/>` under `ModalProvider`
 * (mounted above `MainScreen` in `main.tsx`), not nested inside this
 * component's own provider tree: so the content passed to `open()` must
 * re-wrap `SettingsProvider`/`ScreenProvider`/`SerialDeviceProvider`
 * itself, exactly like `SettingsFab`'s `handleClick` already does. Also
 * wraps `ModalTelemetryBridge` so the wizard's `useUplinkGap()` (which reads
 * the live `system.uplinkHealth` stream) actually sees data; see that
 * component's own doc comment for why the portal doesn't inherit it
 * automatically.
 */
export function UplinkHubWizardHost({
  settingsService,
  serialService,
  analyticsConsent,
}: Readonly<{
  settingsService: SettingsService;
  serialService: SerialDeviceService;
  analyticsConsent: AnalyticsConsentService;
}>) {
  const { open, close } = useModal();
  const openedRef = useRef(false);

  useEffect(() => {
    const openIfClear = () => {
      if (openedRef.current) return;
      if (!analyticsConsent.hasAnswered()) return;
      if (hasSeenUplinkHubWizard()) return;
      openedRef.current = true;
      markUplinkHubWizardSeen();
      openWizard();
    };

    const openWizard = () => {
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
    };

    openIfClear();
    // The operator answering the consent ask is what clears the way, so watch
    // for it rather than leaving the wizard unopened for the whole session.
    return analyticsConsent.subscribe(openIfClear);
  }, [open, close, settingsService, serialService, analyticsConsent]);

  return null;
}
