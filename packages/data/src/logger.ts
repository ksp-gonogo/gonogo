import { logger } from "@gonogo/logger";

// Cached on first call so the hot path (every sample) is a single boolean
// check after the initial resolution. Matches the debugPeer pattern in
// @gonogo/core/src/logger/index.ts.
let enabled: boolean | null = null;

export function debugFlight(
  tag: string,
  context?: Record<string, unknown>,
): void {
  if (enabled === null) {
    try {
      enabled =
        typeof localStorage !== "undefined" &&
        localStorage.getItem("DEBUG_FLIGHT") === "1";
    } catch {
      enabled = false;
    }
  }
  if (!enabled) return;
  logger.debug(`[flight] ${tag}`, context);
}
