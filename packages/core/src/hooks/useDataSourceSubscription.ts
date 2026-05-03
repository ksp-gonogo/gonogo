import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getDataSource, onDataSourcesChange } from "../registry";
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
 *
 * Listens to registry changes and re-runs `setup` against the new source
 * when the slot under `sourceId` is replaced (e.g. live → replay swap).
 * Without this, existing subscribers stay bound to the old source instance
 * after a swap and silently miss every subsequent emission.
 */
export function useDataSourceSubscription<TSnapshot>(
  sourceId: string,
  setup: DataSourceSubscriptionSetup<TSnapshot>,
  initialSnapshot: TSnapshot,
): TSnapshot {
  const snapshotRef = useRef<TSnapshot>(initialSnapshot);

  // Bumps whenever the registry mutates. Included in the `subscribe`
  // memoisation so useSyncExternalStore re-subscribes against the new
  // source on a swap.
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(
    () =>
      onDataSourcesChange(() => {
        setRegistryVersion((v) => v + 1);
      }),
    [],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // `registryVersion` is read here so the dep linter is satisfied; the
      // memo invalidates on every registry mutation regardless.
      void registryVersion;
      const source = getDataSource(sourceId);
      if (!source) return () => {};
      return setup(source, onStoreChange, snapshotRef);
    },
    [sourceId, setup, registryVersion],
  );

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
