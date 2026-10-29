import { createContext, useContext } from "react";
import type { DelayAuthority } from "./delay-authority";

/** The `DelayAuthority` the nearest `TelemetryProvider` built, or `null` when it was handed a store of its own. */
export const DelayAuthorityContext = createContext<DelayAuthority | null>(null);

export function useDelayAuthorityOptional(): DelayAuthority | null {
  return useContext(DelayAuthorityContext);
}
