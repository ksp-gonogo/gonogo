import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * Logs a flight-recognition trace under the logger's `flight` tag, shown when
 * that tag is switched on.
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
