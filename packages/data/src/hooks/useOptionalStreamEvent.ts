import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef } from "react";

/**
 * `useStreamEvent`'s own logic (`@ksp-gonogo/sitrep-client`'s `use-stream-event.ts`),
 * rebuilt on the optional client accessor instead of the throwing
 * `useTelemetryClient`, so `@ksp-gonogo/data` consumers like
 * `AutoRecordController`/`useFlight` can react to a `ReliableOrdered` event
 * topic, e.g. `flight.started`/`flight.ended`, without throwing when no
 * `TelemetryProvider` is mounted.
 *
 * Fires `handler` for each discrete event delivered on `topic` after
 * subscription: the sticky last value `TelemetryClient.subscribe` replays
 * synchronously on subscribe is skipped (same "a widget mounting after the
 * fact does not re-fire" rule `useStreamEvent` documents), so a component
 * that mounts after a flight already ended does not re-close a session that
 * was never open. A topic that reads absent (no vessel at the Space Center, a
 * flight just recovered) is not an event, so `handler` is not called for it.
 * `handler` may change identity every render without re-subscribing (held in
 * a ref). The second argument is the frame's `Meta`, whose `validAt` and
 * `deliveredAt` stamp when the event happened and when it arrived.
 */
export function useOptionalStreamEvent<Payload>(
  topic: string,
  handler: (payload: Payload, meta: Meta | undefined) => void,
): void {
  const client = useTelemetryClientOptional();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!client) return;
    let replayingSticky = true;
    const unsubscribe = client.subscribeFrames(topic, (payload, meta) => {
      if (replayingSticky || payload == null) return;
      handlerRef.current(payload as Payload, meta);
    });
    replayingSticky = false;
    return unsubscribe;
  }, [client, topic]);
}
