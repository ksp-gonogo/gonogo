import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { StationIdentityService } from "./StationIdentityService";

const StationIdentityContext = createContext<StationIdentityService | null>(
  null,
);

export function StationIdentityProvider({
  service,
  children,
}: {
  service: StationIdentityService;
  children: ReactNode;
}) {
  return (
    <StationIdentityContext.Provider value={service}>
      {children}
    </StationIdentityContext.Provider>
  );
}

export function useStationIdentityService(): StationIdentityService {
  const svc = useContext(StationIdentityContext);
  if (!svc) {
    throw new Error(
      "useStationIdentityService must be used inside a <StationIdentityProvider>.",
    );
  }
  return svc;
}

/** Reactive station name: re-renders on rename. */
export function useStationName(): string {
  const svc = useStationIdentityService();
  const [name, setName] = useState(() => svc.getName());
  useEffect(() => svc.onChange(setName), [svc]);
  return name;
}
