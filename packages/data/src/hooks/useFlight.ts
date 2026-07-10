import { getDataSource } from "@ksp-gonogo/core";
import { useCallback, useSyncExternalStore } from "react";
import type { FlightRecord } from "../types";

interface FlightAware {
  getCurrentFlight: () => FlightRecord | null;
  onFlightChange: (cb: (flight: FlightRecord | null) => void) => () => void;
}

function asFlightAware(source: unknown): FlightAware | null {
  if (!source) return null;
  const c = source as Partial<FlightAware>;
  if (
    typeof c.getCurrentFlight !== "function" ||
    typeof c.onFlightChange !== "function"
  ) {
    return null;
  }
  return c as FlightAware;
}

/**
 * Reactive view of the current flight. Re-renders on every transition
 * (new, resume, revert). Returns `null` during warmup or when the
 * registered source doesn't support flight history (e.g. a bare data
 * source mocked into tests).
 *
 * Works on both the main screen (BufferedDataSource) and stations
 * (PeerClientDataSource), which both implement `getCurrentFlight` +
 * `onFlightChange` — main reads its own detector, station reads the
 * cached snapshot pushed by the host.
 */
export function useFlight(sourceId = "data"): FlightRecord | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const source = asFlightAware(getDataSource(sourceId));
      if (!source) return () => {};
      return source.onFlightChange(() => {
        onStoreChange();
      });
    },
    [sourceId],
  );

  const getSnapshot = useCallback(() => {
    return asFlightAware(getDataSource(sourceId))?.getCurrentFlight() ?? null;
  }, [sourceId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
