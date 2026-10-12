import { useCallback, useSyncExternalStore } from "react";
import { useTelemetryClientOptional } from "./context";

/**
 * The command centre the operator has selected to view from, updating when the
 * selection changes. Useful for showing the operator which command centre the
 * screen is viewing from. Used by the vantage control and the signal delay
 * readout.
 *
 * `undefined` until a command centre is chosen, and when no `TelemetryProvider`
 * is mounted. Until then the mod has put the connection at the home command
 * centre, which only the mod can name: pair this with `useObservedVantage` to
 * learn which that is.
 */
export function useSelectedVantage(): string | undefined {
  // gonogo:reads none
  const client = useTelemetryClientOptional();
  const subscribe = useCallback(
    (onChange: () => void) =>
      client ? client.onSelectedVantageChange(onChange) : () => {},
    [client],
  );
  const getSnapshot = useCallback(() => client?.selectedVantage, [client]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
