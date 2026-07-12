import { useCallback, useSyncExternalStore } from "react";
import type { StreamStatusValue } from "./stream-status";
import type { TimelineStore } from "./timeline-store";

/**
 * The staleness/absence surface for a topic (raw or derived), read at
 * whatever `FrameToken` the store's last `beginFrame()` minted — the SAME
 * frame `useTimelineStream(store, topic)` reads the topic's value at.
 * Status rides its own channel, never the value channel (the
 * `useKosScriptStatus` pattern this repo already uses elsewhere): pair the
 * two hooks for `{ value, status }`-shaped widget consumption.
 */
export function useStreamStatus(
  store: TimelineStore,
  topic: string,
): StreamStatusValue {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeFrame(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback(
    () => store.sampleStatus(topic, store.currentFrame()),
    [store, topic],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
