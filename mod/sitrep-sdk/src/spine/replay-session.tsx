import { useModeState } from "./mode-view";

/**
 * Whether a mission replay is on. Useful for refusing an action that needs
 * the live game while the operator is watching a recording. Read by the app's
 * Uplink host, so a script terminal can refuse command dispatch during
 * replay: a replayed flight has no live script processor to run scripts
 * against. A replay is a mode the mod holds, so every screen answers alike.
 */
export function useReplaySessionActive(): boolean {
  return useModeState()?.mode === "replay";
}
