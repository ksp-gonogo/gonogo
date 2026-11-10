import type { ReactNode } from "react";
import { useMemo } from "react";
import { StationIdentityProvider } from "./StationIdentityContext";
import { StationIdentityService } from "./StationIdentityService";

/**
 * Constructs a single StationIdentityService per device and exposes it
 * via context. The service is intentionally singleton-per-mount: identity
 * is per physical screen, persisted in localStorage.
 */
export function ScopedStationIdentity({
  children,
  defaultName,
  seat,
}: {
  children: ReactNode;
  /** What to call this device before anyone has named it. */
  defaultName?: string;
  /** Which seat this screen sits in; each seat keeps its own name. */
  seat?: string;
}) {
  const service = useMemo(
    () =>
      new StationIdentityService(globalThis.localStorage, defaultName, seat),
    [defaultName, seat],
  );
  return (
    <StationIdentityProvider service={service}>
      {children}
    </StationIdentityProvider>
  );
}
