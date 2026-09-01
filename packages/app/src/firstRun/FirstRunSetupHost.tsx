import { useModal } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef } from "react";
import type { AnalyticsConsentService } from "../analytics/AnalyticsConsentService";
import { ModalTelemetryBridge } from "../telemetry/ModalTelemetryBridge";
import { FirstRunSetup } from "./FirstRunSetup";
import { hasSeenFirstRunSetup, markFirstRunSetupSeen } from "./firstRunFlag";

/**
 * The single first-run auto-open. Mounted on the MAIN screen only: a station
 * never talks to the mod directly (see `SettingsModal`'s own `showDataSources`
 * gate), so there is nothing for a station to open.
 *
 * Opens `FirstRunSetup` in a modal. The `gonogo.uplinkHubWizard.firstRunSeen`
 * flag is written the instant the modal opens, not on completion, so the "never
 * re-opens once dismissed" guarantee holds even if the operator closes it
 * immediately.
 *
 * Renders nothing itself, it is a pure side-effect component, same shape as
 * `AnalyticsConsentHost` minus that component's own modal (this one goes
 * through `useModal().open`, `AnalyticsConsentHost` renders its modal inline).
 *
 * Held behind the analytics consent gate. Both auto-open on the same first
 * boot, and before this they did so simultaneously: two `aria-modal="true"`
 * dialogs reachable at once, which the WCAG dialog pattern rules out and which
 * left a keyboard operator tabbing through a flow stacked under a blocking ask
 * they could not reach. Deferring this half is the right one to move, because
 * consent is the gate the app will not proceed past. It also saves the one
 * auto-open the operator ever gets: the first-run flag is written the instant
 * the modal opens, so opening behind a backdrop would have spent it on a flow
 * they never saw.
 *
 * The modal portal renders as a sibling of `<App/>` under `ModalProvider`
 * (mounted above `MainScreen` in `main.tsx`), not nested inside this
 * component's own provider tree, so the content passed to `open()` re-wraps
 * `ModalTelemetryBridge` itself; see that component's own doc comment for why
 * the portal does not inherit it. That bridge is what lets the Uplinks step
 * read the live `system.uplinkHealth` stream.
 */
export function FirstRunSetupHost({
  analyticsConsent,
}: Readonly<{ analyticsConsent: AnalyticsConsentService }>) {
  const { open, close } = useModal();
  const openedRef = useRef(false);

  useEffect(() => {
    const openIfClear = () => {
      if (openedRef.current) return;
      if (!analyticsConsent.hasAnswered()) return;
      if (hasSeenFirstRunSetup()) return;
      openedRef.current = true;
      markFirstRunSetupSeen();

      let modalId = "";
      modalId = open(
        <ModalTelemetryBridge>
          <FirstRunSetup onFinish={() => close(modalId)} />
        </ModalTelemetryBridge>,
        { title: "Set up Gonogo" },
      );
    };

    openIfClear();
    // The operator answering the consent ask is what clears the way, so watch
    // for it rather than leaving this unopened for the whole session.
    return analyticsConsent.subscribe(openIfClear);
  }, [open, close, analyticsConsent]);

  return null;
}
