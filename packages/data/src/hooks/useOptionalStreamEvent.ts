import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import { useEffect, useRef } from "react";

/**
 * `useStreamEvent`'s own logic (`@ksp-gonogo/sitrep-client`'s `use-stream-event.ts`),
 * rebuilt on the OPTIONAL client accessor instead of the throwing
 * `useTelemetryClient` — same "why optional" rationale as
 * `useOptionalVesselIdentity` (extracted so `@ksp-gonogo/data` consumers like
 * `AutoRecordController`/`useFlight` can react to a `ReliableOrdered` event
 * topic — e.g. `flight.started`/`flight.ended` — without throwing when no
 * `TelemetryProvider` is mounted).
 *
 * Fires `handler` for each discrete event delivered on `topic` AFTER
 * subscription — the sticky last value `TelemetryClient.subscribe` replays
 * synchronously on subscribe is skipped (same "a widget mounting after the
 * fact does not re-fire" rule `useStreamEvent` documents), so a component
 * that mounts after a flight already ended does not re-close a session that
 * was never open. `handler` may change identity every render without
 * re-subscribing (held in a ref).
 */
export function useOptionalStreamEvent<T>(
  topic: string,
  handler: (payload: T) => void,
): void {
  const client = useTelemetryClientOptional();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!client) return;
    let replayingSticky = true;
    const unsubscribe = client.subscribe(topic, (payload) => {
      if (replayingSticky) return;
      handlerRef.current(payload as T);
    });
    replayingSticky = false;
    return unsubscribe;
  }, [client, topic]);
}
