import { useCallback, useSyncExternalStore } from "react";
import { useTelemetryStoreOptional } from "./context";

/**
 * Whether the stream to the mod is open, as the transport last said. Useful for
 * telling the operator that nothing can be sent to the game and that readings
 * are not arriving. Used by the dashboard header and by the command controls.
 * True with no stream mounted, because no connection is then being waited on.
 */
export function useStreamConnected(): boolean {
  // gonogo:reads none
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onChange: () => void) =>
      store ? store.subscribeStreamConnected(onChange) : () => {},
    [store],
  );
  const getSnapshot = useCallback(
    () => (store ? store.streamConnected() : true),
    [store],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
