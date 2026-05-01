import {
  type MutableRefObject,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { getDataSource } from "../registry";
import type { DataSource } from "../types";

export type DataSourceSubscriptionSetup<TSnapshot> = (
  source: DataSource,
  notify: () => void,
  snapshotRef: MutableRefObject<TSnapshot>,
) => () => void;

/**
 * Shared scaffolding for hooks that read from a registered `DataSource` via
 * `useSyncExternalStore`. Resolves the source, runs caller-provided `setup`,
 * and exposes a snapshot ref that `setup` mutates and `notify`s on change.
 *
 * Returns the initial snapshot when the source is unregistered, so callers
 * don't have to duplicate the empty-state branch.
 */
export function useDataSourceSubscription<TSnapshot>(
  sourceId: string,
  setup: DataSourceSubscriptionSetup<TSnapshot>,
  initialSnapshot: TSnapshot,
): TSnapshot {
  const snapshotRef = useRef<TSnapshot>(initialSnapshot);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const source = getDataSource(sourceId);
      if (!source) return () => {};
      return setup(source, onStoreChange, snapshotRef);
    },
    [sourceId, setup],
  );

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
