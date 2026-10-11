import { useEffect, useRef } from "react";
import { useTelemetryClientOptional } from "./context";

/**
 * Calls `handler` once for each event delivered on `topic`. Useful for a
 * widget that acts once per event: raising a crash alarm, pushing a
 * notification or logging a mission line. Used with a `ReliableOrdered`
 * channel such as `crash.lastCrash`, where every frame the mod publishes is
 * delivered in order and none is coalesced. To render the latest event, read
 * it with `useStream(topic)`.
 *
 * Every event is delivered, including two that land in the same animation
 * frame. The hook subscribes through the `TelemetryClient`, whose per-topic
 * fan-out delivers each `stream-data` frame on its own; the `TimelineStore`
 * frame path that `useStream` reads coalesces ingests to one per frame.
 *
 * The last value the client replays on subscribe is not an event, so a widget
 * that mounts after a crash does not raise the alarm for it again, and
 * neither does a remount, StrictMode or a layout change. Only frames that
 * arrive after the subscription count.
 *
 * `handler` may change identity on every render without re-subscribing. The
 * latest one is always called, so callers need not memoize it.
 */
export function useStreamEvent<Payload>(
  topic: string,
  handler: (payload: Payload) => void,
): void {
  // Degrade to a no-op when no `TelemetryProvider` is mounted (disconnected),
  // same `*Optional` contract as `useStream`/`useTelemetry`.
  const client = useTelemetryClientOptional();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!client) return;
    // `client.subscribe` replays the sticky last value synchronously, inside
    // this call: flag that window so the replay is skipped and only genuinely
    // new deliveries (which arrive on a later tick, with `replayingSticky`
    // already cleared) reach the handler.
    let replayingSticky = true;
    const unsubscribe = client.subscribe(topic, (payload) => {
      if (replayingSticky) return;
      handlerRef.current(payload as Payload);
    });
    replayingSticky = false;
    return unsubscribe;
  }, [client, topic]);
}
