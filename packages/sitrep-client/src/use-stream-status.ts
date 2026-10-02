import { useCallback, useSyncExternalStore } from "react";
import type { StreamStatusValue } from "./stream-status";
import type { TimelineStore } from "./timeline-store";

/**
 * The staleness/absence surface for a topic (raw or derived), read at
 * whatever `FrameToken` the store's last `beginFrame()` minted, the SAME
 * frame `useTimelineStream(store, topic)` reads the topic's value at.
 * Status rides its own channel, never the value channel: pair the
 * two hooks for `{ value, status }`-shaped widget consumption.
 *
 * With no store there is no stream at all, which is the link-wide
 * `"disconnected"` rather than a fact about this topic.
 */
export function useStreamStatus(
  store: TimelineStore | undefined,
  topic: string,
): StreamStatusValue {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store ? store.subscribeFrame(onStoreChange) : () => {},
    [store],
  );

  const getSnapshot = useCallback(
    () =>
      store ? store.sampleStatus(topic, store.currentFrame()) : "disconnected",
    [store, topic],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
