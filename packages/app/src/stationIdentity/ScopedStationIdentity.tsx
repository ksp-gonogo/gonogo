import type { ReactNode } from "react";
import { useMemo } from "react";
import { StationIdentityProvider } from "./StationIdentityContext";
import { StationIdentityService } from "./StationIdentityService";

/**
 * Constructs a single StationIdentityService per device and exposes it
 * via context. The service is intentionally singleton-per-mount: identity
 * is per physical screen, persisted in localStorage.
 */
export function ScopedStationIdentity({ children }: { children: ReactNode }) {
  const service = useMemo(() => new StationIdentityService(), []);
  return (
    <StationIdentityProvider service={service}>
      {children}
    </StationIdentityProvider>
  );
}
