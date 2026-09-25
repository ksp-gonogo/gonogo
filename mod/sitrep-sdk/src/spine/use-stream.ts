import { useCallback, useSyncExternalStore } from "react";
import { type TopicReading, topicReading } from "../reading";
import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";
import { subscribeTopicRead } from "./subscribe-read";

/**
 * Reactively reads `topic`, raw OR derived, as a {@link TopicReading}: the
 * latest value AND how current it is, from the `TimelineStore` supplied
 * (indirectly, via `TelemetryProvider`'s auto-built default) by the nearest
 * `TelemetryProvider`.
 *
 * A reading rather than the bare payload because the payload outlives the
 * data: the store keeps the last sample after a topic stops arriving, so a bare
 * read goes on handing a widget a confident figure the link has stopped
 * vouching for. The reading makes the caller branch first, exactly as
 * `useTelemetry` does for a typed Topic: `observed` is current, `stale` is the
 * last real observation held (with its instant and grade), and `pending`,
 * `unowned` and `absent` carry no value at all. A derived channel
 * (`vessel.state`) computes its own currency from its inputs, so its reading is
 * as honest as a raw one.
 *
 * It goes through `store.sampleReading(topic, store.currentFrame())`, never
 * `client.getValue(topic)`. `getValue` only ever sees raw `stream-data` frames
 * whose `topic` matches literally, so it is permanently `undefined` for a
 * derived topic like `vessel.state.altitudeAsl`: no server channel ever sends
 * that literal topic string. The store resolves BOTH kinds transparently.
 *
 * `subscribe` does two things, both required for a DERIVED topic to ever
 * actually receive data:
 * - **Everything the read needs held up** (`subscribeTopicRead`): every RAW
 *   input topic `topic` transitively depends on (itself, for an ordinary raw
 *   topic) plus the deps its elected reckoner declared, ref-counted through
 *   `client.subscribe`, redirected to the topics the server actually
 *   understands instead of the derived topic name. That seam is shared with
 *   every other read path in the tree; see its doc for why the reckoner half
 *   belongs there.
 * - **Frame-driven reactivity** (`store.subscribeFrame`): re-renders on every
 *   frame the provider mints, not on a raw per-topic callback, since a derived
 *   value can change from an ingest on any of several input topics.
 *
 * `sampleReading` keeps a reading's identity while its point, status and epoch
 * are unchanged, so `useSyncExternalStore` bails out of re-rendering when
 * nothing relevant to `topic` changed.
 *
 * `pending` with no provider mounted (disconnected, or the frame before
 * `SitrepTelemetryProvider`'s client is built), so a stream widget renders an
 * empty state instead of throwing.
 */
export function useStream<T>(topic: string): TopicReading<T> {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const releaseInputs = subscribeTopicRead(client, store, topic);
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        releaseInputs();
      };
    },
    [client, store, topic],
  );

  const getSnapshot = useCallback((): TopicReading<T> => {
    if (!store) return NO_PROVIDER as TopicReading<T>;
    return store.sampleReading<T>(topic, store.currentFrame());
  }, [store, topic]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * One shared `pending` for the no-provider path: a fresh object per call would
 * fail `useSyncExternalStore`'s reference comparison and loop.
 */
const NO_PROVIDER = topicReading<never>({
  state: "pending",
  reckoning: { status: "none" },
});

/**
 * Reactively reads the latest RAW value for `topic` straight off
 * `TelemetryClient`: `client.getValue(topic)`, kept live via
 * `client.subscribe`: bypassing the delayed/certainty-gated `TimelineStore`
 * frame `useStream` samples through.
 *
 * `useStream` is correct for delayed CRAFT telemetry: it deliberately shows
 * only what the view clock's certainty horizon has reached, so a widget
 * counting down against delayed data stays in step with that same delay.
 * But some topics are command-centre REAL-time bookkeeping, not delayed
 * craft telemetry: `system.uplink.pending` (dispatch timestamps stamped
 * the instant a command leaves the ground station) and `system.uplink.gates`
 * are the current examples. Sampling those through the delayed
 * frame makes them appear (and clear) a whole one-way-delay late; this hook
 * is the fix, it reads the client's sticky last value directly, the same
 * "arrived on the wire, available now" semantics `client.subscribe` already
 * gives a non-React caller.
 *
 * `comms.delay` and `comms.path` are read through here too, and no longer
 * because they are real-time: both are Delayed channels now, so the wire has
 * already held them for a light-time and this hook shows each one the moment it
 * lands rather than any earlier. What it still buys them is independence from
 * the certainty horizon, which matters because `comms.delay` is what sizes that
 * horizon: reading it through the gated frame would ask the view clock for a
 * value the view clock is waiting on.
 *
 * No derived-topic support (unlike `useStream`): `client.getValue` only
 * ever sees raw `stream-data` frames whose `topic` matches literally, so
 * this hook is for raw command-centre topics only, never a derived channel.
 *
 * Degrades to `undefined` with no `TelemetryProvider` mounted, or before
 * anything has arrived for `topic`.
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
