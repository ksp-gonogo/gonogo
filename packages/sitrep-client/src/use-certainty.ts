import { useCallback, useSyncExternalStore } from "react";
import type { TimelineStore } from "./timeline-store";
import type { Certainty } from "./view-clock";

/**
 * Whether the current frame's view is `"confirmed"` (at-or-before the
 * certainty horizon) or `"predicted"` (past it). Rides its
 * own channel, read at the SAME `FrameToken` `useTimelineStream`/
 * `useStreamStatus` read for the same topic (the `useKosScriptStatus`
 * pattern: value, staleness/absence, and certainty are three independent
 * channels a widget composes, never nested inside one another).
 *
 * Certainty is a property of the FRAME's `viewUt`, not of any one topic (the
 * single-view-time invariant) — every topic read in the same
 * frame shares the same certainty. `topic` is accepted anyway (rather than a
 * topic-less `useCertainty(store)`) purely so the hook's call shape matches
 * its siblings and a future per-channel certainty override (were one ever
 * needed) wouldn't be a breaking API change.
 */
export function useCertainty(store: TimelineStore, _topic?: string): Certainty {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeFrame(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback(
    () => store.sampleCertainty(store.currentFrame()),
    [store],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
