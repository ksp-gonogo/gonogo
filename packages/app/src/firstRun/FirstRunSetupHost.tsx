import { useModal } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef } from "react";
import { ModalTelemetryBridge } from "../telemetry/ModalTelemetryBridge";
import { say } from "./copy";
import { FirstRunSetup } from "./FirstRunSetup";
import { hasSeenFirstRunSetup, markFirstRunSetupSeen } from "./firstRunFlag";
import { onFirstRunSetupRequested } from "./firstRunRequest";

/**
 * The single first-run auto-open. Mounted on the main screen only: a station
 * never talks to the mod directly (see `SettingsModal`'s own data-sources
 * gate), so there is nothing for a station to open.
 *
 * Opens `FirstRunSetup` in a modal. The `gonogo.uplinkHubWizard.firstRunSeen`
 * flag is written the instant the modal opens, not on completion, so the "never
 * re-opens once dismissed" guarantee holds even if the operator closes it
 * immediately.
 *
 * Also opens it on request from `requestFirstRunSetup`, which is how Settings
 * reopens it after the first auto-open is spent. The requester closes its own
 * dialog first, so two `aria-modal="true"` dialogs are never up at once.
 *
 * Renders nothing itself, it is a pure side-effect component.
 *
 * The modal portal renders as a sibling of `<App/>` under `ModalProvider`
 * (mounted above `MainScreen` in `main.tsx`), not nested inside this
 * component's own provider tree, so the content passed to `open()` re-wraps
 * `ModalTelemetryBridge` itself; see that component's own doc comment for why
 * the portal does not inherit it. That bridge is what lets the Uplinks and
 * health steps read the live `system.uplinkHealth` stream.
 */
export function FirstRunSetupHost() {
  const { open, close } = useModal();
  const openedRef = useRef(false);

  useEffect(() => {
    const openSetup = () => {
      let modalId = "";
      modalId = open(
        <ModalTelemetryBridge>
          <FirstRunSetup onFinish={() => close(modalId)} />
        </ModalTelemetryBridge>,
        { title: say("shell.title") },
      );
    };

    const openIfClear = () => {
      if (openedRef.current) return;
      if (hasSeenFirstRunSetup()) return;
      openedRef.current = true;
      markFirstRunSetupSeen();
      openSetup();
    };

    openIfClear();
    const stopWatchingRequests = onFirstRunSetupRequested(openSetup);
    return () => {
      stopWatchingRequests();
    };
  }, [open, close]);

  return null;
}
