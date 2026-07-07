import { createContext, type ReactNode, useContext } from "react";
import type { TelemetryClient } from "./client";

const TelemetryClientContext = createContext<TelemetryClient | undefined>(
  undefined,
);

export interface TelemetryProviderProps {
  client: TelemetryClient;
  children: ReactNode;
}

/** Supplies a `TelemetryClient` to the component tree via context. */
export function TelemetryProvider({
  client,
  children,
}: TelemetryProviderProps) {
  return (
    <TelemetryClientContext.Provider value={client}>
      {children}
    </TelemetryClientContext.Provider>
  );
}

/** Reads the `TelemetryClient` supplied by the nearest `TelemetryProvider`. */
export function useTelemetryClient(): TelemetryClient {
  const client = useContext(TelemetryClientContext);
  if (!client) {
    throw new Error(
      "useTelemetryClient must be used within a TelemetryProvider",
    );
  }
  return client;
}

/**
 * Non-throwing variant of `useTelemetryClient` — `undefined` when no
 * `TelemetryProvider` is mounted, instead of throwing.
 *
 * Exists for compatibility shims (`@gonogo/core`'s `useDataValue` →
 * `useStream` migration, M2 Task 7) that must keep working — falling back to
 * a legacy code path — during the migration window before every screen
 * mounts a `TelemetryProvider`. Ordinary SDK-native call sites should keep
 * using `useTelemetryClient` so a missing provider fails loudly.
 */
export function useTelemetryClientOptional(): TelemetryClient | undefined {
  return useContext(TelemetryClientContext);
}
