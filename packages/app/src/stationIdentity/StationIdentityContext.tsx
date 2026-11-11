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

/** The identity service, or `null` where no identity provider is mounted. */
export function useStationIdentityServiceOptional(): StationIdentityService | null {
  return useContext(StationIdentityContext);
}

/**
 * The name, or `undefined` where no identity provider is mounted. For a
 * surface that renders on every screen and cannot assume one, such as a widget
 * a station could place anywhere: it falls back rather than crashing, the same
 * posture `usePeerClient` takes.
 */
export function useStationNameOptional(): string | undefined {
  const svc = useContext(StationIdentityContext);
  const [name, setName] = useState(() => svc?.getName());
  useEffect(() => svc?.onChange(setName), [svc]);
  return svc ? name : undefined;
}

/**
 * The name an operator typed for this device, or `undefined` while it has only
 * its starting name or no identity provider is mounted. For a surface that
 * prefers a better name, such as the centre the screen sits at.
 */
export function useExplicitStationNameOptional(): string | undefined {
  const svc = useContext(StationIdentityContext);
  const [name, setName] = useState(() => svc?.getExplicitName());
  useEffect(() => svc?.onChange(() => setName(svc.getExplicitName())), [svc]);
  return svc ? name : undefined;
}

/** Reactive station name: re-renders on rename. */
export function useStationName(): string {
  const svc = useStationIdentityService();
  const [name, setName] = useState(() => svc.getName());
  useEffect(() => svc.onChange(setName), [svc]);
  return name;
}
