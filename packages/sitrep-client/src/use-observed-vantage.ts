import { useCallback, useSyncExternalStore } from "react";
import { useTelemetryClientOptional } from "./context";

/**
 * The command centre the arriving frames are actually stamped with,
 * reactively: `undefined` until one has arrived, or with no
 * `TelemetryProvider` mounted.
 *
 * The counterpart to `useSelectedVantage`, and the one to reach for wherever a
 * surface must STATE which vantage the data in front of the operator is delayed
 * from rather than reflect a choice they made. On a station the two disagree:
 * its frames are relayed from a host session it does not own, so its own
 * selection never moves off the default while the host's can be anywhere.
 */
export function useObservedVantage(): string | undefined {
  const client = useTelemetryClientOptional();
  const subscribe = useCallback(
    (onChange: () => void) =>
      client ? client.onObservedVantageChange(onChange) : () => {},
    [client],
  );
  const getSnapshot = useCallback(() => client?.observedVantage, [client]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
