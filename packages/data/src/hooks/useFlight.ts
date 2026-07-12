import { getDataSource } from "@ksp-gonogo/core";
import type { FlightStarted } from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { FlightRecord } from "../types";
import { useOptionalStreamEvent } from "./useOptionalStreamEvent";

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
 * Explicit-source variant: reactive view of a registered `DataSource`'s own
 * flight-awareness (`BufferedDataSource`/`PeerClientDataSource`, both of
 * which implement `getCurrentFlight`/`onFlightChange`). Returns `null`
 * during warmup or when `sourceId` isn't registered, or doesn't implement
 * the interface.
 */
function useSourceFlight(sourceId: string): FlightRecord | null {
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

/**
 * Default (no-`sourceId`) variant: derives the current flight straight off
 * the mod-native flight-lifecycle stream (`flight.started` —
 * `docs/superpowers/plans/2026-07-11-flight-lifecycle-spec.md`) instead of
 * the retired client-side `FlightDetector` heuristic. The mod mints the
 * flight id (`Vessel.id`, the same currency `VesselIdentity.VesselId`
 * already uses) and does the revert/switch detection server-side — see
 * `Sitrep.Host.Flight.FlightLifecycleSampler` — so this hook is a thin,
 * event-driven mirror: every `flight.started` becomes the new current
 * flight, full stop.
 *
 * Degrades to `null` — never throws — whenever no `TelemetryProvider` is
 * mounted (every station screen today; see `useOptionalStreamEvent`) or
 * before the stream has produced a first `flight.started` event.
 */
function useStreamFlight(): FlightRecord | null {
  const [flight, setFlight] = useState<FlightRecord | null>(null);

  useOptionalStreamEvent<FlightStarted>(
    "flight.started",
    useCallback((payload) => {
      const now = Date.now();
      setFlight({
        id: payload.flightId,
        vesselName: payload.vesselName,
        vesselUid: payload.vesselId,
        launchedAt: now,
        lastSampleAt: now,
        lastMissionTime: 0,
        sampleCount: 1,
      });
    }, []),
  );

  return flight;
}

/**
 * Reactive view of the current flight. Re-renders on every transition
 * (new, resume, revert). Returns `null` during warmup, when the registered
 * source doesn't support flight history (e.g. a bare data source mocked
 * into tests), or — for the default no-argument form — before the stream
 * has synced.
 *
 * Two call shapes:
 *  - `useFlight()` (no argument, the form `FlightOutcomeBanner` uses):
 *    stream-native, driven by the mod's own `flight.started` events. Works
 *    wherever a `TelemetryProvider` is mounted (the main screen); degrades
 *    to `null` on a station screen, which has none.
 *  - `useFlight(sourceId)`: explicit `DataSource`-based lookup, unchanged
 *    from the original implementation — for any registered source that
 *    still implements `getCurrentFlight`/`onFlightChange` directly
 *    (`BufferedDataSource`, `PeerClientDataSource`).
 */
export function useFlight(sourceId?: string): FlightRecord | null {
  // Both branches are hooks and must run unconditionally on every render
  // (Rules of Hooks) — only one result is actually returned. Each is cheap
  // (a `useSyncExternalStore`/`useState` pair) so computing both costs
  // nothing observable. `sourceId ?? ""` never resolves to a registered
  // `DataSource`, so `sourceFlight` is harmlessly `null` whenever the
  // stream-native branch is the one actually returned.
  const sourceFlight = useSourceFlight(sourceId ?? "");
  const streamFlight = useStreamFlight();
  return sourceId ? sourceFlight : streamFlight;
}
