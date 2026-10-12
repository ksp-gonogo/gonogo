import { useRef } from "react";
import {
  type CommsDelayLike,
  currentMode,
  type DelayMode,
  deriveInFlight,
  type InFlightCommand,
  latchForward,
  type PendingEntry,
} from "../command-delay";
import { useUtNow } from "./context";
import { useLatestValue } from "./use-stream";

/** The part of the `PendingUplinkQueue` wire payload that `useRouteCommands` reads. */
export interface PendingUplinkQueueLike {
  pending: PendingEntry[];
}

export interface UseRouteCommandsResult {
  items: InFlightCommand[];
  mode: DelayMode;
}

/**
 * Every command still on its way to `topic` (for example `kos/7`), whichever
 * command centre sent it, with the delay mode in force. Useful for showing the
 * operator the commands in flight to a device, including ones sent from
 * another command centre, which the command's own dispatch history cannot see.
 * Offered to Uplink widgets through the host.
 *
 * It keeps no history: a command that ages out of the pending queue stops
 * appearing. A caller that needs to detect a failure after that point reads
 * `inFlight` from `useCommand` for its own dispatches.
 *
 * It reads `system.uplink.pending` and `comms.delay` straight off the wire,
 * and times the commands against the real-time clock.
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
