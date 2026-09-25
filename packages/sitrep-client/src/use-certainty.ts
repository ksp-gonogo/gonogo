import { useCallback, useSyncExternalStore } from "react";
import type { TimelineStore } from "./timeline-store";
import type { Certainty } from "./view-clock";

/**
 * Whether `topic` is `"confirmed"` (at-or-before its lane's certainty horizon)
 * or `"predicted"` (past it) in the current frame. Rides its own channel, read
 * at the SAME `FrameToken` `useTimelineStream`/`useStreamStatus` read for the
 * same topic: value, staleness/absence and certainty are three independent
 * channels a widget composes, never nested inside one another.
 *
 * Per topic because a frame reads two view times a light-time apart, one per
 * delay lane, and each is judged against its own horizon. It stays out of
 * `TopicReading<T>` all the same: certainty is shared by every topic on one
 * lane in one frame, so nesting it per read would duplicate one fact and admit
 * two reads of it disagreeing.
 */
export function useCertainty(store: TimelineStore, topic: string): Certainty {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeFrame(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback(
    () => store.sampleCertainty(topic, store.currentFrame()),
    [store, topic],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
