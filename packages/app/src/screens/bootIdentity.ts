import { logger } from "@ksp-gonogo/logger";
import { currentRoute } from "./route";
import { getJoined, getStartSeat } from "./seatChoice";

/**
 * Stamps this page load's role on the log identity from its URL and the seat
 * this browser remembers, so lines written before the peer services start
 * (boot, Uplink loading) are filed as the main screen, a station or a pilot
 * instead of an unknown device. The peer services add the device id later,
 * once they know it.
 */
export function stampBootRole(): void {
  if (currentRoute() === "join") {
    logger.setIdentity({ role: getJoined()?.seat ?? "station" });
    return;
  }
  logger.setIdentity({ role: getStartSeat() === "pilot" ? "pilot" : "host" });
}
