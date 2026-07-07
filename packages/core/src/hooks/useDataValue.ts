import { mapTopic, useTelemetryClientOptional } from "@gonogo/sitrep-client";
import { useCallback, useSyncExternalStore } from "react";
import type { DataSource, DataSourceRegistry } from "../types";
import { useDataSourceSubscription } from "./useDataSourceSubscription";

/**
 * Subscribe to a live value from a registered data source.
 *
 * **Typed overload** — when the source ID is registered in `DataSourceRegistry`,
 * the key is constrained to valid keys for that source and the return type is
 * inferred automatically:
 *
 *   // DataSourceRegistry has { data: { 'v.altitude': number; ... } }
 *   const alt = useDataValue('data', 'v.altitude');
 *   //    ^ number | undefined  ✓  — no <T> annotation needed
 *
 * **Fallback overload** — for sources not yet in the registry, or when an
 * explicit type annotation is preferred (backward-compatible with existing code):
 *
 *   const val = useDataValue<boolean>('data', dynamicKey);
 *   //    ^ boolean | undefined
 *
 * ---
 *
 * **The M3 `useStream` compatibility shim (M2 Task 7).** Internally this
 * hook now routes through `mapTopic(dataSourceId, key)`
 * (`@gonogo/sitrep-client`, seeded from `m1-provider-taxonomy-design.md`
 * §5's old-Telemachus-key → new-stream-topic migration table):
 *
 * - **Mapped key + a `TelemetryProvider` is mounted** → reads reactively
 *   from the new SDK's `TelemetryClient` (the same primitive `useStream`
 *   uses), so a widget that has been quietly reclassified in the migration
 *   table starts riding the new streaming pipeline with ZERO code change and
 *   zero test change — the return contract (`T | undefined`, `undefined`
 *   while nothing has arrived yet) is identical.
 * - **Unmapped key, or no `TelemetryProvider` in the tree yet** → falls back
 *   to the legacy registered `DataSource` path unchanged. This is what lets
 *   M3 migrate widgets (and mount `TelemetryProvider`) group-by-group: an
 *   unmigrated screen with no provider behaves exactly as it does today, and
 *   a key the migration table hasn't reached yet (an M1 §5.2 "known gap")
 *   keeps working off the old `DataSource` even once the provider is live.
 *
 * The one semantic delta, flagged rather than silently reproduced (M2 design
 * §6): the legacy path clears to `undefined` when the `DataSource` status
 * leaves `"connected"`; the new streamed path does not — a `TelemetryClient`
 * holds the last-known value (M2's staleness model supersedes blunt
 * clear-on-disconnect, but that richer status only reaches a widget once
 * *it* is consciously migrated to `useStreamStatus` in M3). Until then this
 * is a defensible, documented gap, not a silent regression.
 *
 * Both the legacy subscription and the streamed subscription are always
 * wired up (stable hook order — this hook must not call a different set of
 * hooks across renders); only one of the two snapshots is actually returned,
 * chosen by whether `mapTopic` produced a topic and a provider is mounted.
 * Deleted at M4 per the shim's own retirement plan.
 */
// Typed overload: source is in DataSourceRegistry → key and return type are inferred
export function useDataValue<
  TSource extends keyof DataSourceRegistry,
  TKey extends keyof DataSourceRegistry[TSource] & string,
>(
  dataSourceId: TSource,
  key: TKey,
): DataSourceRegistry[TSource][TKey] | undefined;

// Fallback overload: source NOT in DataSourceRegistry, or explicit T annotation.
// Excludes known source IDs so that passing a registered source with an invalid
// key produces a compile error rather than silently falling through to unknown.
export function useDataValue<T = unknown>(
  dataSourceId: Exclude<string, keyof DataSourceRegistry>,
  key: string,
): T | undefined;

// Implementation (not part of the public API surface)
export function useDataValue(dataSourceId: string, key: string): unknown {
  const legacySetup = useCallback(
    (
      source: DataSource,
      notify: () => void,
      snapshotRef: { current: unknown },
    ) => {
      const unsubData = source.subscribe(key, (val) => {
        snapshotRef.current = val;
        notify();
      });
      const unsubStatus = source.onStatusChange((status) => {
        if (status !== "connected") {
          snapshotRef.current = undefined;
          notify();
        }
      });
      return () => {
        unsubData();
        unsubStatus();
      };
    },
    [key],
  );
  const legacyValue = useDataSourceSubscription<unknown>(
    dataSourceId,
    legacySetup,
    undefined,
  );

  // The shim: always subscribed (stable hook order), only consulted when
  // `mapTopic` resolves AND a TelemetryProvider is actually mounted.
  const client = useTelemetryClientOptional();
  const topic = mapTopic(dataSourceId, key);

  const subscribeStream = useCallback(
    (onStoreChange: () => void) => {
      if (!client || topic === undefined) return () => {};
      return client.subscribe(topic, () => onStoreChange());
    },
    [client, topic],
  );
  const getStreamSnapshot = useCallback(
    () => (client && topic !== undefined ? client.getValue(topic) : undefined),
    [client, topic],
  );
  const streamedValue = useSyncExternalStore(
    subscribeStream,
    getStreamSnapshot,
  );

  if (client && topic !== undefined) {
    return streamedValue;
  }
  return legacyValue;
}
