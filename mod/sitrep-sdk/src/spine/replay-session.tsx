import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { TelemetryProvider } from "./context";
import {
  getReplaySessionController,
  type ReplaySessionSnapshot,
} from "./replay-session-controller";

/**
 * Shows a mission replay in place of the live stream. Useful for letting the
 * operator replay a recorded flight on the same widgets as a live one. Used by
 * the main screen and the flights manager.
 *
 * Mount it once, wrapping the whole dashboard tree. When a mission replay is
 * active, it shadows whatever live `TelemetryProvider` wraps it (nested
 * providers: nearest wins) with the replay session's own client and store, so
 * every widget below keeps reading through the same `useTelemetry` surface with no
 * replay awareness of its own. When idle, which is the common case, it renders
 * `children` untouched, matching `SitrepTelemetryProvider`'s pass-through when
 * disabled.
 */
export function ReplaySessionProvider({ children }: { children: ReactNode }) {
  const controller = getReplaySessionController();
  const snapshot = useSyncExternalStore<ReplaySessionSnapshot>(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot(),
  );

  if (!snapshot.active || !snapshot.client || !snapshot.store) {
    return <>{children}</>;
  }

  return (
    <TelemetryProvider client={snapshot.client} store={snapshot.store}>
      {children}
    </TelemetryProvider>
  );
}

/**
 * Whether a mission replay is currently active. Useful for refusing an action
 * that needs the live game while the operator is watching a recording. Read by
 * the app's Uplink host, so a script terminal can refuse command dispatch during
 * replay: a replayed session has no live script processor to run scripts against.
 */
export function useReplaySessionActive(): boolean {
  const controller = getReplaySessionController();
  return useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot().active,
  );
}
