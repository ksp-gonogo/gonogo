import { useCallback, useEffect, useRef } from "react";
import type { TopicId, TopicPayload } from "../topics";
import { useTelemetryClientOptional } from "./context";

/** Ends one subscription started through `LateTelemetrySubscribe`. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * The imperative subscribe function `useLateTelemetrySubscribe` returns.
 * Two overloads, mirroring `useTelemetry`'s canonical/fallback split:
 *
 * - a `TopicId` argument infers the payload type from `TopicPayloadMap`,
 *   the same canonical typing `useTelemetry(topic)` gives a static topic.
 * - a plain `string` argument (for a runtime-templated topic like
 *   `scansat.mask.${body}.${scanType}`, which has no fixed member in the
 *   `TopicId` union) falls back to an explicit `Payload` type argument at the
 *   call site.
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
 * Returns one stable `subscribe(topic, callback)` function, for subscribing
 * to Topics that are known only after some async setup resolves, in a number
 * decided at runtime. Useful where `useTelemetry` and `useStream` cannot
 * serve, since each of their call sites names its Topic on every render.
 *
 * `subscribe` reads through the nearest `TelemetryProvider`'s
 * `TelemetryClient`: the last value is replayed synchronously on subscribe
 * and every later arrival is delivered as it lands, with no delay gating and
 * no per-frame coalescing.
 *
 * The returned function:
 * - is stable across renders (safe to put in a `useCallback`/`useEffect`
 *   dependency array, or to close over once and call later),
 * - resolves the current client at call time, not the one seen at the
 *   render that produced it, so it keeps working when called from inside
 *   an async `.then()` well after this hook's own render,
 * - can be called any number of times, including zero,
 * - returns an idempotent `Unsubscribe`: calling it more than once, or
 *   after this hook's owner has already unmounted, is a no-op.
 *
 * Every subscription still open when the calling component unmounts is
 * torn down automatically. Call the returned `Unsubscribe` only to end a
 * subscription before unmount.
 *
 * With no `TelemetryProvider` mounted at call time it is a no-op that
 * returns a no-op `Unsubscribe`, and it does not throw.
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
