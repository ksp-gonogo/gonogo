import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * Flight-detection tracing on the logger's "flight" tag, printed when `LOG_TAGS` enables it.
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
