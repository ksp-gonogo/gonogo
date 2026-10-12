import { useCallback, useEffect, useRef } from "react";
import type { TopicId, TopicPayload } from "../topics";
import { useTelemetryClientOptional } from "./context";

/**
 * Ends one subscription started through `LateTelemetrySubscribe`. Useful for
 * stopping a subscription before its component unmounts. Returned by
 * `LateTelemetrySubscribe`. Safe to call more than once.
 */
export type Unsubscribe = () => void;

/**
 * The imperative subscribe function that {@link useLateTelemetrySubscribe}
 * returns. Useful for subscribing to a Topic after some asynchronous setup
 * completes. Used by the app's Uplink host. It has two overloads, matching
 * `useTelemetry`:
 *
 * - a `TopicId` argument infers the payload type from `TopicPayloadMap`, the same
 *   typing `useTelemetry(topic)` gives a static topic
 * - a plain `string` argument (for a topic templated at runtime, such as
 *   `scansat.mask.${body}.${scanType}`, which has no fixed member in the `TopicId`
 *   union) takes an explicit `Payload` type argument at the call site
 */
export interface LateTelemetrySubscribe {
  <Topic extends TopicId>(
    topic: Topic,
    onValue: (value: TopicPayload<Topic>) => void,
  ): Unsubscribe;
  <Payload = unknown>(
    topic: string,
    onValue: (value: Payload) => void,
  ): Unsubscribe;
}

/**
 * Returns one stable `subscribe(topic, callback)` function, for subscribing to
 * Topics that are known only after some async setup resolves, in a number decided
 * at runtime. Useful where `useTelemetry` and `useStream` cannot serve, since each
 * of their call sites names its Topic on every render. Used by the app's Uplink
 * host.
 *
 * `subscribe` reads through the nearest `TelemetryProvider`'s `TelemetryClient`:
 * the last value is replayed synchronously on subscribe and every later arrival is
 * delivered as it lands, with no delay gating and no per-frame coalescing.
 *
 * The returned function:
 *
 * - is stable across renders (safe in a dependency array, or to close over once and
 *   call later)
 * - resolves the current client at call time, so it keeps working when called from
 *   inside an async callback well after this hook's own render
 * - can be called any number of times, including zero
 * - returns an idempotent `Unsubscribe`: calling it more than once, or after this
 *   hook's owner has unmounted, does nothing
 *
 * Every subscription still open when the calling component unmounts is torn down
 * automatically. Call the returned `Unsubscribe` only to end a subscription before
 * unmount.
 *
 * With no `TelemetryProvider` mounted at call time it does nothing and returns an
 * `Unsubscribe` that does nothing. It does not throw.
 */
export function useLateTelemetrySubscribe(): LateTelemetrySubscribe {
  // gonogo:reads none
  const client = useTelemetryClientOptional();
  // Read fresh at call time (see the doc comment above): `subscribe` may be
  // invoked long after the render that captured this hook's return value,
  // by which point `client` here would be stale.
  const clientRef = useRef(client);
  clientRef.current = client;

  // Every subscription still open, so unmount can sweep them all. A `Set` of
  // the `Unsubscribe` closures themselves (not tokens/ids): each closure
  // removes itself from this set on its own first call, so an early
  // caller-initiated unsubscribe and the unmount sweep can never double-run
  // the same teardown.
  const openRef = useRef<Set<Unsubscribe>>(new Set());

  const subscribe = useCallback(
    (topic: string, onValue: (value: unknown) => void): Unsubscribe => {
      const currentClient = clientRef.current;
      if (!currentClient) return () => {};
      const unsubscribeFromClient = currentClient.subscribe(topic, onValue);
      let unsubscribed = false;
      const unsubscribe: Unsubscribe = () => {
        if (unsubscribed) return;
        unsubscribed = true;
        unsubscribeFromClient();
        openRef.current.delete(unsubscribe);
      };
      openRef.current.add(unsubscribe);
      return unsubscribe;
    },
    [],
  ) as LateTelemetrySubscribe;

  useEffect(() => {
    const open = openRef.current;
    return () => {
      for (const unsubscribe of open) unsubscribe();
      open.clear();
    };
  }, []);

  return subscribe;
}
