import { useEffect, useRef } from "react";
import type { Meta } from "../__generated__/contract";
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
 * neither does a remount, StrictMode or a layout change. Only events that
 * arrive after the subscription count. An event the mod sends again after a
 * reconnect or a change of command centre is not delivered twice.
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
    /*
     * `client.subscribe` replays the sticky last value synchronously, inside
     * the call: that window is flagged so the replay is skipped and only later
     * deliveries reach the handler.
     *
     * The mod also answers a resubscribe, which follows every reconnect and
     * every change of command centre, with the Topic's last sample as a new
     * frame. It is the same event, so each delivery is compared with the last
     * one seen, the replayed one included, by the sample it carries: the frame's
     * own sequence number is new on every frame, and two events can share an
     * instant and a payload.
     */
    let replayingSticky = true;
    let lastSeen: string | undefined;
    const unsubscribe = client.subscribeFrames(topic, (payload, meta) => {
      const seen = eventKey(payload, meta);
      const repeat = seen !== undefined && seen === lastSeen;
      lastSeen = seen;
      if (replayingSticky || repeat) return;
      handlerRef.current(payload as Payload);
    });
    replayingSticky = false;
    return unsubscribe;
  }, [client, topic]);
}

/**
 * What makes two deliveries the same event: the timeline, the recorded sample
 * and its instant. Sample ids start again when the game restarts, on the same
 * timeline epoch, so the instant tells a new event from an old one that took
 * the same id. A frame that names no sample, which the mod never sends on a
 * stream, falls back to its instant and payload. `undefined` where the frame's
 * `Meta` is not known.
 */
function eventKey(
  payload: unknown,
  meta: Meta | undefined,
): string | undefined {
  if (meta === undefined) return undefined;
  const epoch = meta.timelineEpoch ?? 0;
  if (meta.sampleId != null) {
    return `${epoch}\0#${meta.sampleId}\0${meta.validAt}`;
  }
  return `${epoch}\0${meta.validAt}\0${JSON.stringify(payload)}`;
}
