import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * Logs a flight-recognition trace under the logger's `flight` tag, shown when
 * that tag is switched on. Useful for finding out why a flight was or was not
 * recognised as started, landed or crashed. Used by the flight detector and the
 * flight recorder.
 *
 * @category Flight recording
 */
export function debugFlight(
  event: string,
  context?: Record<string, unknown>,
): void {
  if (!hasHost()) return;
  logger.tag("flight").debug(event, context);
}
