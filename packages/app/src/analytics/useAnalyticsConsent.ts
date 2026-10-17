import { useSyncExternalStore } from "react";
import { analyticsConsentService } from "./AnalyticsConsentService";

/** Whether technical analytics is on, and the setter that persists the choice and tells every subscriber. */
export function useAnalyticsConsent(): readonly [
  enabled: boolean,
  setEnabled: (next: boolean) => void,
] {
  const enabled = useSyncExternalStore(
    (cb) => analyticsConsentService.subscribe(cb),
    () => analyticsConsentService.isEnabled(),
  );
  return [
    enabled,
    (next) => analyticsConsentService.set(next ? "enabled" : "disabled"),
  ];
}

/** The current analytics run's id, undefined while analytics is off. */
export function useAnalyticsRunId(): string | undefined {
  return useSyncExternalStore(
    (cb) => analyticsConsentService.subscribe(cb),
    () => analyticsConsentService.runId(),
  );
}
