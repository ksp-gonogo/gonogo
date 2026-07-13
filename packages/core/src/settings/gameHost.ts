import { getSetting } from "./store";

/** The one shared key: the host the game (KSP) + mod run on. */
export const GAME_HOST_KEY = "gameHost";

/**
 * The authoritative host every Uplink dials. `saved ?? seed ?? build-default`,
 * where the build default is `VITE_SITREP_HOST` (bundle floor) or `localhost`.
 * Ports are per-service and NOT part of this — callers append their own.
 */
export function getGameHost(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const buildDefault = env?.VITE_SITREP_HOST || "localhost";
  return getSetting(GAME_HOST_KEY) ?? buildDefault;
}
