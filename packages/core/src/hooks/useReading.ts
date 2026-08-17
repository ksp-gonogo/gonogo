import {
  type Reading,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import type { TopicId, TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useSyncExternalStore } from "react";

/**
 * One shared `pending` for the no-provider path. A fresh object per call would
 * fail `useSyncExternalStore`'s reference comparison and loop, the same reason
 * the mounted path reads through the store's frame memo.
 */
const PENDING: Reading<never> = { state: "pending" };

/**
 * `useTelemetry`, except the widget cannot render the value without saying how
 * current it is.
 *
 * Same read path as `useTelemetry`'s canonical Topic overload (same store,
 * same frame, same subscription ref-counting), sampled at the SAME
 * `FrameToken` the store's last `beginFrame()` minted, so a widget can mix the
 * two hooks and both see one frozen view time. The difference is only in what
 * comes back: a `Reading<T>` union instead of `T | undefined`, so reaching a
 * value requires branching, and the branch is where the caveat gets rendered.
 * See `Reading`'s own doc for why that mechanism, and for the three-channel
 * rule this deliberately bends.
 *
 * The status comes from `store.sampleStatus`, which is the whole six-valued
 * `StreamStatusValue` the store already derives, so nothing about staleness is
 * inferred here. This hook is plumbing over `readingFrom`.
 *
 * With no `TelemetryProvider` mounted the reading is `pending`, never `stale`:
 * a widget on a disconnected dashboard has observed nothing, so it has no
 * last-observed value, and `stale` would promise one it cannot supply. That
 * matches every other `use*` hook's disconnected contract (degrade to an empty
 * state rather than throw, so the ErrorBoundary does not turn a disconnected
 * dashboard into a wall of error cards).
 *
 * No carried-channels gate, for the same reason `useTelemetry`'s canonical
 * overload has none: that gate exists to protect a legacy DataSource fallback,
 * and a native Topic read has no fallback to protect.
 *
 * To render an age, pair this with `useViewUt()` and `readingAge`. Never
 * `Date.now()`: see `readingAge`'s doc.
 */
export function useReading<T extends TopicId>(
  topic: T,
): Reading<TopicPayload<T>> {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      // A status read needs the same real `client.subscribe` on the topic's
      // resolved raw inputs as a value read does, or a transport delivers
      // nothing on the unsubscribed topic and the reading never leaves
      // `pending`. `useWidgetStreamStatus` carries the same note.
      const unsubscribeInputs = store
        .resolveSubscriptionTopics(topic)
        .map((inputTopic) => client.subscribe(inputTopic, () => {}));
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic],
  );

  const getSnapshot = useCallback((): Reading<TopicPayload<T>> => {
    // `store.sampleReading` rather than composing `sample` + `sampleStatus`
    // here: it memoizes the union on the store's per-frame cache, and
    // `useSyncExternalStore` compares snapshots by reference, so building a
    // fresh object per call would loop forever rather than merely allocate.
    if (!store) return PENDING as Reading<TopicPayload<T>>;
    return store.sampleReading<TopicPayload<T>>(topic, store.currentFrame());
  }, [store, topic]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
