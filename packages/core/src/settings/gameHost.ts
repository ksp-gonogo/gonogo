import { getSetting } from "./store";

/** The one shared key: the host the game (KSP) + mod run on. */
export const GAME_HOST_KEY = "gameHost";

/**
 * The authoritative host every Uplink dials. `saved ?? seed ?? build-default`,
 * where the build default is `VITE_SITREP_HOST` (bundle floor) or `localhost`.
 * Ports are per-service and NOT part of this, callers append their own.
 */
export function getGameHost(): string {
  /* Spelled `import.meta.env` on purpose: Vite substitutes that exact text,
     and a read it cannot see (`Reflect.get(import.meta, "env")`) is undefined
     in both the dev server and the bundle. */
  const configured: unknown = (
    import.meta as ImportMeta & { env?: Record<string, unknown> }
  ).env?.VITE_SITREP_HOST;
  const buildDefault =
    typeof configured === "string" && configured ? configured : "localhost";
  return getSetting(GAME_HOST_KEY) ?? buildDefault;
}
