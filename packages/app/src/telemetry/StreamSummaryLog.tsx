import { logger } from "@ksp-gonogo/logger";
import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import { useEffect } from "react";
import { startStreamSummary } from "./streamSummary";

/**
 * Writes what the game's stream delivered to this screen every ten seconds,
 * with the numbers of the view clock it feeds. Renders nothing.
 */
export function StreamSummaryLog() {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  useEffect(() => {
    if (!client || !store) return;
    return startStreamSummary(client, store.clock, logger.tag("sitrep"));
  }, [client, store]);
  return null;
}
