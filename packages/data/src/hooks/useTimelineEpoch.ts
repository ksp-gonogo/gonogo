import { useTelemetryStoreOptional } from "@ksp-gonogo/sitrep-client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * The timeline the nearest `TelemetryProvider` is showing, as a number that goes
 * up each time the game starts a new one (a revert, a quickload, another save),
 * or `undefined` with no provider mounted. Re-renders its caller only when the
 * number changes. Useful for a widget that keeps its own history of the flight,
 * which must start over when the flight it holds no longer happened.
 */
export function useTimelineEpoch(): number | undefined {
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onChange: () => void) =>
      store ? store.subscribeFrame(onChange) : () => {},
    [store],
  );
  const read = useCallback(() => store?.clock.getEpoch(), [store]);
  return useSyncExternalStore(subscribe, read, read);
}
