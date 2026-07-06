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
