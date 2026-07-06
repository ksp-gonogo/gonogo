import { useCallback, useState, useSyncExternalStore } from "react";
import { useTelemetryClient } from "./context";
import type { CommandStatus } from "./lifecycle";

/** Shared constant so `getSnapshot` returns a referentially stable value when
 * no command has been dispatched yet — a fresh object literal here would
 * make `useSyncExternalStore` believe the snapshot changes on every render
 * and loop forever. */
const IDLE: CommandStatus = { phase: "idle" };

export interface UseCommandResult {
  send: (args?: unknown) => Promise<unknown>;
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
  const client = useTelemetryClient();
  const [requestId, setRequestId] = useState<string | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => client.subscribeStore(onStoreChange),
    [client],
  );

  const getSnapshot = useCallback(
    () => (requestId ? client.getCommand(requestId) : IDLE),
    [client, requestId],
  );

  const status = useSyncExternalStore(subscribe, getSnapshot);

  const send = useCallback(
    (args?: unknown) => {
      const { requestId: newRequestId, result } = client.dispatch(
        command,
        args,
      );
      setRequestId(newRequestId);
      return result;
    },
    [client, command],
  );

  return { send, status };
}
