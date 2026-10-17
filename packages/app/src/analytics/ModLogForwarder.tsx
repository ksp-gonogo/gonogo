import { logger } from "@ksp-gonogo/logger";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef } from "react";
import {
  getSitrepHello,
  getSitrepTransportStatus,
  onSitrepTransportStatusChange,
} from "../telemetry/sitrepRuntime";
import { ModLogCursor } from "./modLogCursor";
import { useAnalyticsConsent } from "./useAnalyticsConsent";

const POLL_MS = 15_000;
/** As many lines as the mod keeps, so a slow poll loses as little as it can. */
const MAX_LINES = 400;

/**
 * Copies the mod's own `KSP.log` lines into the app log, tagged `mod`, so they
 * reach the log store beside the app's entries for the same run. Reads the
 * mod's recent lines every fifteen seconds and on every connection, and logs
 * each line once, in order. Runs only on the main screen, only while the game
 * is connected and only while analytics is on, so nothing is read or kept
 * from the mod while it is off.
 */
export function ModLogForwarder() {
  const [enabled] = useAnalyticsConsent();
  const recentLog = useCommand("system.log.recent", { rail: false });
  const send = useRef(recentLog.send);
  send.current = recentLog.send;

  useEffect(() => {
    if (!enabled) return;
    const cursor = new ModLogCursor();
    const log = logger.tag("mod");
    let busy = false;
    let stopped = false;

    const poll = async () => {
      if (busy || getSitrepTransportStatus() !== "connected") return;
      busy = true;
      try {
        const reply = await send.current({ maxLines: MAX_LINES });
        if (stopped || !reply.success || !reply.payload) return;
        const { fresh, missed } = cursor.take(
          reply.payload.lines,
          reply.payload.total,
          getSitrepHello()?.bootId,
        );
        if (missed.isPositive())
          log.warn(`${writeQuantity(missed)} mod lines were not captured`);
        for (const line of fresh) log.info(line);
      } catch {
        // the command outcome is already logged; the next poll tries again
      } finally {
        busy = false;
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const off = onSitrepTransportStatusChange((status) => {
      if (status === "connected") void poll();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      off();
    };
  }, [enabled]);

  return null;
}
