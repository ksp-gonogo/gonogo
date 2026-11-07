import { logger } from "@ksp-gonogo/logger";
import type { SystemUplinkHealth } from "@ksp-gonogo/sitrep-client";
import {
  type UplinkHealthStateName,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import { useEffect, useRef } from "react";

const log = logger.tag("uplink-health");

/**
 * The health state an Uplink's roster entry reports, with the reason the mod
 * gives for it: the Uplink's own detail while it is available, else the
 * reason it is unavailable.
 */
function reasonOf(entry: SystemUplinkHealth["uplinks"][number]): string | null {
  return entry.health.detail ?? entry.reason;
}

/**
 * Writes one log line each time an Uplink's reported health changes: warn when
 * it becomes degraded, error when it becomes unavailable, info when it
 * recovers. An Uplink is taken to be healthy before the first roster read, so
 * one already unhealthy when the app opens logs once. Renders nothing. Mod-side faults reach the log buffer and the
 * remote log store this way.
 */
export function UplinkHealthLogger() {
  const reading = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const seen = useRef(new Map<string, UplinkHealthStateName>());
  const roster =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : null;
  useEffect(() => {
    if (!roster) return;
    for (const entry of roster.uplinks) {
      const next = entry.health.state;
      const previous = seen.current.get(entry.id) ?? "healthy";
      seen.current.set(entry.id, next);
      if (previous === next) continue;
      const reason = reasonOf(entry);
      const message = `Uplink ${entry.id} health ${previous} -> ${next}${reason ? `: ${reason}` : ""}`;
      const context = { uplinkId: entry.id, from: previous, to: next, reason };
      if (next === "unavailable") {
        log.error(message, undefined, context);
        continue;
      }
      if (next === "degraded") {
        log.warn(message, context);
        continue;
      }
      log.info(message, context);
    }
  }, [roster]);
  return null;
}
