import { useCallback, useSyncExternalStore } from "react";
import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";

/**
 * Reactively reads the latest value for `topic` — raw OR derived — from the
 * `TimelineStore` supplied (indirectly, via `TelemetryProvider`'s auto-built
 * default) by the nearest `TelemetryProvider`.
 *
 * This used to read `client.getValue(topic)` directly, which
 * only ever saw raw `stream-data` frames whose `topic` matched literally —
 * permanently `undefined` for a derived topic like `vessel.state.altitudeAsl`,
 * since no server channel ever sends that literal topic string. Routing
 * through `store.sample(topic, store.currentFrame())` instead resolves BOTH
 * kinds transparently (`TimelineStore.sample`'s whole point, per its own doc:
 * "callers never need to know whether a topic is raw or derived").
 *
 * `subscribe` does two things, both required for a DERIVED topic to ever
 * actually receive data:
 * - **Derived-input ref-counting** (`store.resolveSubscriptionTopics`):
 *   subscribes every RAW input topic `topic` transitively depends on (itself,
 *   for an ordinary raw topic) via `client.subscribe` — ref-counted exactly
 *   like before, just redirected to the topics the server actually
 *   understands instead of the derived topic name.
 * - **Frame-driven reactivity** (`store.subscribeFrame`): re-renders on every
 *   frame the provider mints (`TelemetryProvider` calls `beginFrame()` on
 *   every ingest tick), not on a raw per-topic callback — the same
 *   `useTimelineStream` pattern this hook now shares, since a derived value
 *   can change from an ingest on any of several input topics, not one fixed
 *   topic name.
 *
 * `getSnapshot` reads `store.sample(topic, store.currentFrame())`, which
 * returns the same memoized `TimelinePoint` object within a frame — so
 * `useSyncExternalStore` correctly bails out of re-rendering when nothing
 * relevant to `topic` actually changed.
 */
export function useStream<T>(topic: string): T | undefined {
  // Degrade gracefully when no `TelemetryProvider` is mounted (disconnected,
  // or the frame before `SitrepTelemetryProvider`'s client is built) — mirror
  // `useTelemetry`'s `*Optional` contract so a stream widget renders an empty
  // state instead of throwing (which the ErrorBoundary would otherwise turn
  // into an error card on every disconnected dashboard).
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
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
    [client, store, topic],
  );

  const getSnapshot = useCallback((): T | undefined => {
    if (!store) return undefined;
    const point = store.sample<T>(topic, store.currentFrame());
    // `point.payload` may itself be `null` (a confirmed tombstone) — passed
    // through as-is, same as the pre-bridge `client.getValue()` read would
    // have for a raw topic; only "no point at all" collapses to `undefined`.
    return point ? (point.payload as T | undefined) : undefined;
  }, [store, topic]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Reactively reads the latest RAW value for `topic` straight off
 * `TelemetryClient` — `client.getValue(topic)`, kept live via
 * `client.subscribe` — bypassing the delayed/certainty-gated `TimelineStore`
 * frame `useStream` samples through.
 *
 * `useStream` is correct for delayed CRAFT telemetry: it deliberately shows
 * only what the view clock's certainty horizon has reached, so a widget
 * counting down against delayed data stays in step with that same delay.
 * But some topics are command-centre REAL-time bookkeeping, not delayed
 * craft telemetry — `system.uplink.pending` (dispatch timestamps stamped
 * the instant a command leaves the ground station) and `comms.delay`/
 * `comms.connectivity` (facts about the link itself, not about the
 * vessel) are the current examples. Sampling those through the delayed
 * frame makes them appear (and clear) a whole one-way-delay late; this hook
 * is the fix — it reads the client's sticky last value directly, the same
 * "arrived on the wire, available now" semantics `client.subscribe` already
 * gives a non-React caller.
 *
 * No derived-topic support (unlike `useStream`) — `client.getValue` only
 * ever sees raw `stream-data` frames whose `topic` matches literally, so
 * this hook is for raw command-centre topics only, never a derived channel.
 *
 * Degrades to `undefined` with no `TelemetryProvider` mounted (or before
 * anything has arrived for `topic`), matching every other `useStream`-family
 * hook's disconnected contract.
 */
export function useLatestValue<T>(topic: string): T | undefined {
  const client = useTelemetryClientOptional();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client) return () => {};
      return client.subscribe(topic, onStoreChange);
    },
    [client, topic],
  );

  const getSnapshot = useCallback((): T | undefined => {
    if (!client) return undefined;
    return client.getValue(topic) as T | undefined;
  }, [client, topic]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
