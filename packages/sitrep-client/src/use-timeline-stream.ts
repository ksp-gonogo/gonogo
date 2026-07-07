import { useCallback, useSyncExternalStore } from "react";
import type { TimelineStore } from "./timeline-store";

/**
 * The `useStream(topic)` shape built on the M2 timeline foundation
 * (`TimelineStore`/`ViewClock`) rather than `TelemetryClient`'s raw
 * `lastValues` map (see `use-stream.ts` for that still-current production
 * hook — this is additive, not a replacement; the full `mapTopic` collapse
 * described in the M2 design §6 is later work).
 *
 * Reads `store.sample(topic, store.currentFrame())` — i.e. at whatever
 * `FrameToken` the store's last `beginFrame()` minted, never a token this
 * hook computes itself. That's what gives every `useTimelineStream` call
 * across the whole tree the same frozen `viewUt` for a given frame, even
 * across renders that happen at different points within it.
 *
 * Returns `T | null | undefined`: `undefined` = no point at-or-before the
 * current `viewUt` yet (cold topic, or resynchronizing after an epoch
 * reset); `null` = a tombstone (confirmed absence — M2 design §4). Neither
 * case is exercised by T2's own tests beyond the plumbing; the
 * absence/staleness model is a later task.
 */
export function useTimelineStream<T>(
  store: TimelineStore,
  topic: string,
): T | null | undefined {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeFrame(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback(() => {
    const point = store.sample<T>(topic, store.currentFrame());
    return point ? point.payload : undefined;
  }, [store, topic]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
