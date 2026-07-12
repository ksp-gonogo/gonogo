import { useEffect, useRef } from "react";
import { useTelemetryClientOptional } from "./context";

/**
 * Fires `handler` for each discrete event delivered on `topic` — the
 * consumption side of a `ReliableOrdered` channel (e.g. `crash.lastCrash`),
 * where every frame the server publishes is delivered in order and none is
 * coalesced away. Where `useStream` reads the sticky latest VALUE of a state
 * topic and re-renders, this hook reacts to each ARRIVAL: the natural shape for
 * a widget that must do something once per event (raise a crash alarm, push a
 * notification, log a mission line) rather than render a current reading.
 *
 * Subscribes straight through the `TelemetryClient` rather than the
 * `TimelineStore`/frame path `useStream` uses: the store coalesces ingests to
 * one `beginFrame()` per animation frame, which would drop the second of two
 * events landing in the same tick — exactly the coalescing the reliable lane
 * exists to prevent. The client's per-topic fan-out delivers every
 * `stream-data` frame individually, so a burst of events each fire the handler.
 *
 * The sticky last value the client replays synchronously on subscribe is NOT
 * treated as an event: it is the already-seen latest, so a widget mounting
 * after a crash does not re-raise the alarm for it (and remounts — StrictMode,
 * a layout change — never re-fire). Only frames arriving after subscription
 * count. A widget that instead wants to RENDER the last event should read it
 * with `useStream(topic)`.
 *
 * `handler` may change identity every render without re-subscribing — the
 * latest one is always called (held in a ref), so callers need not memoize it.
 */
export function useStreamEvent<T>(
  topic: string,
  handler: (payload: T) => void,
): void {
  // Degrade to a no-op when no `TelemetryProvider` is mounted (disconnected)
  // — same `*Optional` contract as `useStream`/`useTelemetry`.
  const client = useTelemetryClientOptional();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!client) return;
    // `client.subscribe` replays the sticky last value synchronously, inside
    // this call — flag that window so the replay is skipped and only genuinely
    // new deliveries (which arrive on a later tick, with `replayingSticky`
    // already cleared) reach the handler.
    let replayingSticky = true;
    const unsubscribe = client.subscribe(topic, (payload) => {
      if (replayingSticky) return;
      handlerRef.current(payload as T);
    });
    replayingSticky = false;
    return unsubscribe;
  }, [client, topic]);
}
