import { useCallback, useState, useSyncExternalStore } from "react";
import { useTelemetryClientOptional } from "./context";
import type { CommandStatus } from "./lifecycle";

/** Shared constant so `getSnapshot` returns a referentially stable value when
 * no command has been dispatched yet — a fresh object literal here would
 * make `useSyncExternalStore` believe the snapshot changes on every render
 * and loop forever. */
const IDLE: CommandStatus = { phase: "idle" };

export interface UseCommandResult {
  /**
   * `opts.label` is an opaque, operator-facing description of the command
   * (e.g. line-mode's composed line text) threaded straight through to
   * `TelemetryClient.dispatch`'s envelope — it plays no role in dispatch,
   * correlation, or loss inference.
   */
  send: (args?: unknown, opts?: { label?: string }) => Promise<unknown>;
  status: CommandStatus;
}

/**
 * Fires `command` against the `TelemetryClient` from the nearest
 * `TelemetryProvider` and reactively reflects its lifecycle
 * (`idle -> in-flight -> confirmed|failed`).
 *
 * The active `requestId` is held in React state so `send` can be called
 * more than once; `status` is read via `useSyncExternalStore` over
 * `client.subscribeStore`, so any status transition for the in-flight
 * request re-renders the caller.
 */
export function useCommand(command: string): UseCommandResult {
  // Degrade gracefully with no `TelemetryProvider` mounted (disconnected):
  // status stays IDLE and `send` is a no-op — you can't dispatch a command
  // with no link, and the hook must not throw just because the dashboard
  // rendered before a connection exists.
  const client = useTelemetryClientOptional();
  const [requestId, setRequestId] = useState<string | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client ? client.subscribeStore(onStoreChange) : () => {},
    [client],
  );

  const getSnapshot = useCallback(
    () => (client && requestId ? client.getCommand(requestId) : IDLE),
    [client, requestId],
  );

  const status = useSyncExternalStore(subscribe, getSnapshot);

  const send = useCallback(
    (args?: unknown, opts?: { label?: string }) => {
      if (!client) return Promise.resolve(undefined);
      const { requestId: newRequestId, result } = client.dispatch(
        command,
        args,
        opts?.label,
      );
      setRequestId(newRequestId);
      return result;
    },
    [client, command],
  );

  return { send, status };
}
