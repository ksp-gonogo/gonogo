import { useRef } from "react";
import {
  type CommsDelayLike,
  currentMode,
  type DelayMode,
  deriveInFlight,
  type InFlightCommand,
  latchForward,
  type PendingEntry,
} from "./command-delay";
import { useUtNow } from "./context";
import { useLatestValue } from "./use-stream";

/** Structural subset of the `PendingUplinkQueue` wire payload this hook reads. */
export interface PendingUplinkQueueLike {
  pending: PendingEntry[];
}

export interface UseRouteCommandsResult {
  items: InFlightCommand[];
  mode: DelayMode;
}

/**
 * Cross-origin route reader: every currently-pending command addressed to
 * `topic` (e.g. `kos/7`), regardless of which command centre dispatched it
 * (`PendingUplink.vantage`) — the one thing `useCommand`'s own-dispatch
 * memory can't see. Queue-only, no memory of its own: an entry that ages
 * out of `system.uplink.pending` simply stops appearing here (a caller that
 * needs failure detection after age-out wants `useCommand`'s `inFlight`
 * instead, for its OWN dispatches).
 *
 * Reads `system.uplink.pending`/`comms.delay` via `useLatestValue` (real-time
 * command-centre bookkeeping, not the certainty-gated delayed view) and
 * `nowUt` via `useUtNow` — the same real-time clock reads the kOS terminal's
 * original hand-rolled strip used, for the same reason (see `useLatestValue`'s
 * own doc). `latchForward` guards the returned phases against a transient
 * `nowUt` judder the same way the terminal's own `isPastReach` did.
 */
export function useRouteCommands(topic: string): UseRouteCommandsResult {
  const queue = useLatestValue<PendingUplinkQueueLike>("system.uplink.pending");
  const commsDelay = useLatestValue<CommsDelayLike>("comms.delay");
  const nowUt = useUtNow() ?? 0;
  const latchMemory = useRef<Map<string, InFlightCommand>>(new Map());

  const entries = (queue?.pending ?? []).filter(
    (entry) => entry.topic === topic,
  );
  const items = latchForward(
    deriveInFlight(entries, nowUt),
    latchMemory.current,
  );
  const mode = currentMode(commsDelay);

  return { items, mode };
}
