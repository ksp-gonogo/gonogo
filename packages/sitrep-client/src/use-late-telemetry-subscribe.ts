import type { TopicId, TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useEffect, useRef } from "react";
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
 *   `TopicId` union) falls back to an explicit `T` type argument at the
 *   call site.
 */
export interface LateTelemetrySubscribe {
  <K extends TopicId>(
    topic: K,
    onValue: (value: TopicPayload<K>) => void,
  ): Unsubscribe;
  <T = unknown>(topic: string, onValue: (value: T) => void): Unsubscribe;
}

/**
 * A narrow, lifecycle-managed escape hatch for subscribing to telemetry
 * topics that are only known after some async setup resolves, in a count
 * decided at runtime, rather than a fixed set a component can declare
 * up front. `useTelemetry`/`useStream` are declarative: every call site
 * names its topic(s) unconditionally on every render, which cannot express
 * "subscribe to N topics once an async cache acquire settles for each one".
 * This hook is the deliberately small seam for that case: it hands back one
 * stable `subscribe` function instead of the whole `TelemetryClient`, so an
 * author gets exactly "subscribe a callback to a topic, get an unsubscribe
 * back" and nothing more.
 *
 * `subscribe` reads through the nearest `TelemetryProvider`'s
 * `TelemetryClient` (`TelemetryClient.subscribe`), the same client
 * `useTelemetry`'s canonical read and `useStreamEvent` use: sticky last
 * value replayed synchronously on subscribe, every later arrival delivered
 * as it lands, no delay gating or per-frame coalescing (a `TimelineStore`
 * frame sample would introduce both, which is wrong for state that is not
 * delayed craft telemetry).
 *
 * The returned function:
 * - is stable across renders (safe to put in a `useCallback`/`useEffect`
 *   dependency array, or to close over once and call later),
 * - resolves the CURRENT client at CALL time, not the one seen at the
 *   render that produced it, so it keeps working when called from inside
 *   an async `.then()` well after this hook's own render,
 * - can be called any number of times, including zero,
 * - returns an idempotent `Unsubscribe`: calling it more than once, or
 *   after this hook's owner has already unmounted, is a no-op.
 *
 * Every subscription still open when the calling component unmounts is
 * torn down automatically (tracked in a ref, swept in one cleanup effect):
 * a caller only needs to call the returned `Unsubscribe` early, for a
 * subscription it wants to end before unmount, never on unmount itself.
 *
 * Degrades to a no-op subscribe (no throw, no-op returned `Unsubscribe`)
 * when no `TelemetryProvider` is mounted at call time, matching every other
 * `*Optional`-shaped hook in this package.
 */
export function useLateTelemetrySubscribe(): LateTelemetrySubscribe {
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
