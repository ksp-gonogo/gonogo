import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import { useEffect } from "react";
import type { CommcastLog } from "./CommcastLog";
import { attachCommcastModLink } from "./CommcastModLink";

/**
 * Puts a screen-level log on the mod through the Sitrep client above it.
 * Renders nothing; mount it inside the telemetry provider.
 */
export function CommcastLink({ log }: { log: CommcastLog | null }) {
  const client = useTelemetryClientOptional();
  useEffect(() => {
    if (!log || !client) return;
    return attachCommcastModLink(log, client);
  }, [log, client]);
  return null;
}
