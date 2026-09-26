import { useEffect, useState } from "react";
import { LocalManeuverTriggerService } from "./LocalManeuverTriggerService";
import {
  type ManeuverTriggerService,
  useManeuverTriggerService,
} from "./triggerService";

/** A host service on the main screen, a client service on stations, an in-process one without a provider. */
export function usePlannerTriggerService(): ManeuverTriggerService {
  const providedTriggerService = useManeuverTriggerService();
  const [fallbackTriggerService] = useState<ManeuverTriggerService | null>(
    () => (providedTriggerService ? null : new LocalManeuverTriggerService()),
  );
  useEffect(() => {
    return () => {
      if (fallbackTriggerService instanceof LocalManeuverTriggerService) {
        fallbackTriggerService.dispose();
      }
    };
  }, [fallbackTriggerService]);
  return (
    providedTriggerService ?? (fallbackTriggerService as ManeuverTriggerService)
  );
}
