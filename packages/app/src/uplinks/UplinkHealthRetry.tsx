import { logger } from "@ksp-gonogo/logger";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { useEffect, useMemo, useRef } from "react";
import { VERSION } from "../version";
import { loaderBootIdsOverride } from "./flag";
import { hostCompat } from "./hostCompat";
import { loadFromLiveRoster, type RosterEntry } from "./loader";
import { localRegistrySource } from "./registry";
import { decodeRosterPayload } from "./rosterProbe";

/**
 * Loads the Uplink clients the live roster makes loadable after startup. The
 * startup load reads the roster once, so a page opened before the game is
 * running attempts nothing, and an expansion-gated Uplink reports unavailable
 * until KSP has filled its expansion list. Each roster this reads loads the
 * clients startup never attempted and the ones whose health refusal has lifted.
 *
 * Renders nothing. Mount inside the main screen's telemetry provider. A station
 * follows its main screen's set instead, through `StationUplinkLoader`.
 */
export function UplinkHealthRetry() {
  const reading = useStream<unknown>("system.uplinks");
  const roster = useMemo(
    () =>
      reading.state === "observed" || reading.state === "held"
        ? decodeRosterPayload(reading.value)
        : undefined,
    [reading],
  );
  const running = useRef(false);
  const waiting = useRef<RosterEntry[] | null>(null);

  useEffect(() => {
    if (!roster) return;
    /* A roster that arrives while a load is running is kept and read when that
       load ends, because the stream may not send another one. */
    if (running.current) {
      waiting.current = roster;
      return;
    }
    const run = (next: RosterEntry[]): void => {
      running.current = true;
      void loadFromLiveRoster({
        registrySource: localRegistrySource(),
        override: loaderBootIdsOverride(),
        hostCompat,
        appVersion: VERSION,
        roster: next,
      })
        .catch((err) => {
          logger.error(
            "[uplink-loader] live roster load threw",
            err instanceof Error ? err : new Error(String(err)),
          );
        })
        .finally(() => {
          running.current = false;
          const queued = waiting.current;
          waiting.current = null;
          if (queued) run(queued);
        });
    };
    run(roster);
  }, [roster]);

  return null;
}
