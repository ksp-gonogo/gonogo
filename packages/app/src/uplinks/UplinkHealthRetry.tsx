import { logger } from "@ksp-gonogo/logger";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { useEffect, useMemo, useRef } from "react";
import { VERSION } from "../version";
import { hostCompat } from "./hostCompat";
import { type LoaderContext, reloadHealthRefusals } from "./loader";
import { localRegistrySource } from "./registry";
import { decodeRosterPayload } from "./rosterProbe";

/**
 * Loads an Uplink's client again when the live roster stops reporting it
 * unavailable. The boot-time load reads the roster once, and an expansion-gated
 * Uplink reports unavailable until KSP has filled its expansion list, so a page
 * opened in that window would otherwise lose the client for good.
 *
 * Renders nothing. Mount inside the telemetry provider; a station passes the
 * peer conduit's `fetchBytes`.
 */
export function UplinkHealthRetry({
  fetchBytes,
}: {
  fetchBytes?: LoaderContext["fetchBytes"];
}) {
  const reading = useStream<unknown>("system.uplinks");
  const roster = useMemo(
    () =>
      reading.state === "observed" || reading.state === "held"
        ? decodeRosterPayload(reading.value)
        : undefined,
    [reading],
  );
  const running = useRef(false);

  useEffect(() => {
    if (!roster || running.current) return;
    running.current = true;
    void reloadHealthRefusals({
      registrySource: localRegistrySource(),
      hostCompat,
      appVersion: VERSION,
      roster,
      fetchBytes,
    })
      .catch((err) => {
        logger.error(
          "[uplink-loader] health retry threw",
          err instanceof Error ? err : new Error(String(err)),
        );
      })
      .finally(() => {
        running.current = false;
      });
  }, [roster, fetchBytes]);

  return null;
}
