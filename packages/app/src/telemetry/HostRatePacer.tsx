import { logger } from "@ksp-gonogo/logger";
import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import { tierSamplesPerSecondOf } from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";
import { HostPacer, PaceMonitor } from "../peer/stationPace";

const paceLogger = logger.tag("peer:pace");

/**
 * Lowers the rate the mod sends the fast tier at while the main screen itself
 * cannot keep up, and lifts it again once it can. Every screen, stations
 * included, then receives the fast Topics at that rate. Renders nothing.
 */
export function HostRatePacer() {
  const client = useTelemetryClientOptional();

  useEffect(() => {
    if (!client) return;
    const monitor = new PaceMonitor();
    const pacer = new HostPacer();
    let capped = false;
    monitor.start();
    const timer = setInterval(() => {
      const reading = monitor.reading();
      const modRate = tierSamplesPerSecondOf(
        client.getValue("system.dataRates"),
        "fast",
      );
      const cap = pacer.look(reading, modRate, performance.now());
      if (cap === undefined) return;
      client.capRate("fast", cap);
      capped = cap !== null;
      paceLogger.info(
        `main screen ${cap === null ? "lifts its cap" : `caps the fast tier at ${cap}`} lag=${reading.loopLagMs.toFixed(0)}ms frame=${reading.frameMs.toFixed(0)}ms`,
      );
    }, 1_000);
    return () => {
      clearInterval(timer);
      monitor.stop();
      if (capped) client.capRate("fast", null);
    };
  }, [client]);

  return null;
}
