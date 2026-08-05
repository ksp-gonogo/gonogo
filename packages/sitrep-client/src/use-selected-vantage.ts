import { useCallback, useSyncExternalStore } from "react";
import { useTelemetryClientOptional } from "./context";

/**
 * The selected command-centre vantage (Plan 3), reactively: the component
 * re-renders when `client.setVantage` changes it, so a widget can reflect
 * "viewing from: <centre>" without owning the selection itself. Returns the
 * client's default `"ksc"` when no `TelemetryProvider` is mounted.
 */
export function useSelectedVantage(): string {
  const client = useTelemetryClientOptional();
  const subscribe = useCallback(
    (onChange: () => void) =>
      client ? client.onSelectedVantageChange(onChange) : () => {},
    [client],
  );
  const getSnapshot = useCallback(
    () => client?.selectedVantage ?? "ksc",
    [client],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
