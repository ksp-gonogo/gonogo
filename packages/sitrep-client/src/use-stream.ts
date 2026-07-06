import { useCallback, useSyncExternalStore } from "react";
import { useTelemetryClient } from "./context";

/**
 * Reactively reads the latest value for `topic` from the `TelemetryClient`
 * supplied by the nearest `TelemetryProvider`.
 *
 * Backed by `useSyncExternalStore`: `subscribe` ref-counts a topic
 * subscription for the lifetime of the mount (via `client.subscribe`) and
 * `getSnapshot` reads `client.getValue`, which returns the same stored
 * reference until a new `stream-data` sample arrives — so the store correctly
 * bails out of re-rendering when nothing has changed.
 */
export function useStream<T>(topic: string): T | undefined {
  const client = useTelemetryClient();

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client.subscribe(topic, () => onStoreChange()),
    [client, topic],
  );

  const getSnapshot = useCallback(
    () => client.getValue(topic) as T | undefined,
    [client, topic],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
