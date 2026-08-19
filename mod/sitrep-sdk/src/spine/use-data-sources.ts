import { useCallback, useSyncExternalStore } from "react";
import { getDataSources } from "../api/registry";

export interface DataSourceState {
  id: string;
  name: string;
  status: import("../api/types").DataSourceStatus;
}

export function useDataSources(): DataSourceState[] {
  // subscribe tells React which external events should trigger a re-check.
  // getDataSources() is called inside the callback so it always sees the
  // current set of registered sources without needing them as a dependency.
  const subscribe = useCallback((onStoreChange: () => void) => {
    const unsubscribers = getDataSources().map((s) =>
      s.onStatusChange(onStoreChange),
    );
    return () =>
      unsubscribers.forEach((u) => {
        u();
      });
  }, []);

  // getSnapshot returns a primitive so React can compare by equality.
  const getSnapshot = useCallback(
    () =>
      getDataSources()
        .map((s) => s.status)
        .join(","),
    [],
  );

  // useSyncExternalStore re-reads the snapshot on every onStoreChange call,
  // and guarantees the update is processed synchronously, eliminating act() warnings
  // caused by WebSocket/external events updating state outside React's scheduler.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return getDataSources().map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
  }));
}
