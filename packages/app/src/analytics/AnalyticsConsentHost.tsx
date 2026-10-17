import { logger } from "@ksp-gonogo/logger";
import { useEffect } from "react";
import type { PeerHostService } from "../peer/PeerHostService";
import type { AnalyticsConsentService } from "./AnalyticsConsentService";
import { createBrowserConsentController } from "./axiomTransportFactory";

/**
 * Main-screen consent orchestrator. Does two things, both reactive to the
 * host-owned consent value:
 *
 *  1. Gates this browser's Axiom transport (install on enabled, remove on
 *     disabled). Console + ring buffer are untouched.
 *  2. Pushes the current consent to `PeerHostService` so it broadcasts to
 *     every connected/joining station.
 *
 * The host's relay post + heartbeat re-assert lives in PeerHostService,
 * driven by the same `setAnalyticsConsent` call.
 */
export function AnalyticsConsentHost({
  service,
  peerHost,
}: {
  service: AnalyticsConsentService;
  peerHost: PeerHostService;
}) {
  useEffect(() => {
    const controller = createBrowserConsentController();

    const apply = () => {
      const enabled = service.isEnabled();
      const runId = service.runId();
      // Before the transport goes in, so the backfill joins this run.
      logger.setRunId(runId);
      controller.apply(enabled);
      // Feed the host service so it broadcasts to stations AND keeps the relay config broker in sync (POST on change + heartbeat re-assert).
      peerHost.setAnalyticsConsent(enabled, runId);
    };

    // Apply the persisted value immediately on mount, then on every change.
    apply();
    const unsub = service.subscribe(apply);
    return () => {
      unsub();
      // Detach the Axiom sink on unmount so a remount starts clean.
      controller.apply(false);
      logger.setRunId(undefined);
    };
  }, [service, peerHost]);

  return null;
}
