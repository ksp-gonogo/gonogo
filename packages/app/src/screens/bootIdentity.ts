import { logger } from "@ksp-gonogo/logger";
import { currentRoute } from "./isStationRoute";

/**
 * Stamps this page load's role on the log identity from its URL, so lines
 * written before the peer services start (boot, Uplink loading) are filed as
 * the main screen, a station or a pilot instead of an unknown device. The
 * peer services add the device id later, once they know it.
 */
export function stampBootRole(): void {
  const route = currentRoute();
  logger.setIdentity({ role: route === "main" ? "host" : route });
}
