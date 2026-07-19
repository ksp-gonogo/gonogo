import { TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import {
  getReplaySessionController,
  type ReplaySessionSnapshot,
} from "./ReplaySessionController";

/**
 * Mount once, wrapping the whole dashboard tree — the `ReplayController`
 * "swap the registered `data` source" replacement. When a mission replay is
 * active, this shadows whatever live `TelemetryProvider` wraps it (nested
 * providers: nearest wins) with the replay session's own client/store, so
 * every widget below keeps reading through the exact same
 * `useTelemetry`/`useDataValue` surface it always does — no widget-side
 * replay awareness needed. Renders `children` untouched when idle (the
 * common case): zero overhead, matching `SitrepTelemetryProvider`'s own
 * "disabled -> pass through" contract.
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
 * Whether a mission replay is currently active — the `useReplayActive`
 * replacement. Consumed by `KosTerminal` to refuse command dispatch during
 * replay (a replayed session has no live kOS CPU to run scripts against).
 */
export function useReplaySessionActive(): boolean {
  const controller = getReplaySessionController();
  return useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot().active,
  );
}
