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
