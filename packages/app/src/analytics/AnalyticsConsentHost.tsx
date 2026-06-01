import { useEffect, useState } from "react";
import type { PeerHostService } from "../peer/PeerHostService";
import { AnalyticsConsentModal } from "./AnalyticsConsentModal";
import type { AnalyticsConsentService } from "./AnalyticsConsentService";
import { createBrowserConsentController } from "./axiomTransportFactory";

/**
 * Main-screen consent orchestrator. Does three things, all reactive to the
 * host-owned consent value:
 *
 *  1. Gates this browser's Axiom transport (install on enabled, remove on
 *     disabled). Console + ring buffer are untouched.
 *  2. Pushes the current consent to `PeerHostService` so it broadcasts to
 *     every connected/joining station.
 *  3. Renders the blocking boot modal while consent is unanswered.
 *
 * The host's relay POST + heartbeat re-assert (item 5) lives in
 * PeerHostService, driven by the same `setAnalyticsConsent` call.
 */
export function AnalyticsConsentHost({
  service,
  peerHost,
}: {
  service: AnalyticsConsentService;
  peerHost: PeerHostService;
}) {
  const [answered, setAnswered] = useState(() => service.hasAnswered());

  useEffect(() => {
    const controller = createBrowserConsentController();

    const apply = () => {
      const enabled = service.isEnabled();
      controller.apply(enabled);
      // Feed the host service so it broadcasts to stations AND keeps the
      // relay config broker in sync (POST on change + heartbeat re-assert).
      peerHost.setAnalyticsConsent(enabled);
    };

    // Apply the persisted value immediately on mount, then on every change.
    apply();
    const unsub = service.subscribe(() => {
      apply();
      setAnswered(service.hasAnswered());
    });
    return () => {
      unsub();
      // Detach the Axiom sink on unmount so a remount starts clean.
      controller.apply(false);
    };
  }, [service, peerHost]);

  if (answered) return null;
  return <AnalyticsConsentModal service={service} />;
}
