import { logger } from "@ksp-gonogo/logger";
import { useEffect } from "react";
import type { PeerClientService } from "../peer/PeerClientService";
import { createBrowserConsentController } from "./axiomTransportFactory";

/**
 * Gates this browser's Axiom transport on the main screen's analytics switch,
 * for a screen that joins the main screen as a peer (a station or a pilot).
 * Such a screen never reads a consent of its own: it ships while the main
 * screen says analytics is on, stamped with the main screen's run, and stops
 * the moment it says off. Unmounting stops it too, so a screen that has left
 * keeps nothing running under an old grant.
 */
export function useFollowHostAnalytics(client: PeerClientService): void {
  useEffect(() => {
    const controller = createBrowserConsentController();
    const unsub = client.onAnalyticsConsent((enabled, runId) => {
      logger.setRunId(runId);
      controller.apply(enabled);
    });
    return () => {
      unsub();
      controller.apply(false);
      logger.setRunId(undefined);
    };
  }, [client]);
}
