import { useCallback, useSyncExternalStore } from "react";
import { useTelemetryClientOptional } from "./context";

/**
 * The selected command-centre vantage (Plan 3), reactively: the component
 * re-renders when `client.setVantage` changes it, so a widget can reflect
 * "viewing from: <centre>" without owning the selection itself.
 *
 * `undefined` until the client chooses a centre, and when no
 * `TelemetryProvider` is mounted. Until then the mod has put the connection at
 * the home command, which only the mod can name: pair this with
 * `useObservedVantage` to learn where that is.
 */
export function useSelectedVantage(): string | undefined {
  const client = useTelemetryClientOptional();
  const subscribe = useCallback(
    (onChange: () => void) =>
      client ? client.onSelectedVantageChange(onChange) : () => {},
    [client],
  );
  const getSnapshot = useCallback(() => client?.selectedVantage, [client]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
