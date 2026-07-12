import {
  isTopicCarried,
  mapTopic,
  type StreamStatusValue,
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import { useCallback, useSyncExternalStore } from "react";
import type { DataSource, DataSourceStatus } from "../types";
import { useDataSourceSubscription } from "./useDataSourceSubscription";

/**
 * Legacy `DataSource.status` -> the M2 staleness/absence surface
 * (`StreamStatusValue`). Not a perfect mapping — the legacy status has no
 * concept of per-TOPIC absence/held-stale, only whole-source connectivity —
 * but it gives an unmigrated (or not-yet-carried) widget a real, sensibly
 * ranked status instead of a hardcoded placeholder: `"connected"` reads
 * `"live"` (the common case, so an unmigrated widget shows no badge at all,
 * matching today's behavior exactly); `"reconnecting"` reads `"held-stale"`
 * (a transient, still-recoverable blip); `"disconnected"`/`"error"` both read
 * `"disconnected"` (the link-wide fact `StreamStatusValue` itself
 * distinguishes from a topic-specific absence).
 */
function legacyToStreamStatus(status: DataSourceStatus): StreamStatusValue {
  switch (status) {
    case "connected":
      return "live";
    case "reconnecting":
      return "held-stale";
    case "disconnected":
    case "error":
      return "disconnected";
  }
}

/**
 * The staleness/absence surface for a legacy `(dataSourceId, key)` pair —
 * the M3 "adopt staleness/certainty" shim (`m3-migration-plan.md` §2 item 3,
 * §Build 1), sibling to `useDataValue` (read) and `useExecuteAction`
 * (write). Same allowlist-gated, legacy-fallback contract:
 *
 * - **Mapped key + a `TelemetryProvider` is mounted + the resolved topic is
 *   CARRIED** -> the real `StreamStatusValue` off the `TimelineStore`
 *   (`store.sampleStatus`, mirroring `@ksp-gonogo/sitrep-client`'s own
 *   `useStreamStatus` — not called directly for the same "always-wired,
 *   stable hook order across a dynamic `dataSourceId`/`key`" reason
 *   `useDataValue`'s doc comment gives for mirroring `useStream`).
 * - **Everything else** (unmapped key, no provider, mapped-but-not-carried)
 *   -> `legacyToStreamStatus(source.status)`, so an unmigrated widget still
 *   gets a meaningful status instead of an inert placeholder.
 */
export function useDataStreamStatus(
  dataSourceId: string,
  key: string,
): StreamStatusValue {
  // Memoized (matches `useDataValue.ts`'s `legacySetup`) — an inline
  // function here would give `useDataSourceSubscription`'s `subscribe` a new
  // identity every render, and `useSyncExternalStore` requires a stable
  // `subscribe` reference to correctly resolve the "already-connected before
  // mount" initial read (the ref's real value is only set once `subscribe`
  // actually runs, one tick after the first render's default snapshot).
  const legacySetup = useCallback(
    (
      source: DataSource,
      notify: () => void,
      snapshotRef: { current: DataSourceStatus },
    ) => {
      snapshotRef.current = source.status;
      notify();
      return source.onStatusChange((status) => {
        snapshotRef.current = status;
        notify();
      });
    },
    [],
  );
  const legacyStatus = useDataSourceSubscription<DataSourceStatus>(
    dataSourceId,
    legacySetup,
    "disconnected",
  );
  const legacyStreamStatus = legacyToStreamStatus(legacyStatus);

  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const carriedChannels = useCarriedChannelsOptional();
  const topic = mapTopic(dataSourceId, key);
  const carried =
    store !== undefined &&
    topic !== undefined &&
    carriedChannels !== undefined &&
    isTopicCarried(store, carriedChannels, topic);
  const routable =
    client !== undefined &&
    store !== undefined &&
    topic !== undefined &&
    carried;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store || topic === undefined || !routable) {
        return () => {};
      }
      // Mirrors `useDataValue`'s `subscribeStream` (and, underneath it,
      // `@ksp-gonogo/sitrep-client`'s `useStream`): a status read needs the same
      // real `client.subscribe` on the topic's resolved raw inputs as a
      // value read — for a `StubTransport`/real transport, nothing is
      // actually delivered on an unsubscribed topic (`StubTransport.emit`'s
      // own subscription-gating), so a status-only hook that skipped this
      // would never see a live topic ever leave `"resyncing"`.
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic, routable],
  );
  const getSnapshot = useCallback(() => {
    if (!store || topic === undefined || !routable) return legacyStreamStatus;
    return store.sampleStatus(topic, store.currentFrame());
  }, [store, topic, routable, legacyStreamStatus]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
