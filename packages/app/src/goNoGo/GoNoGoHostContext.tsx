import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { GoNoGoHostService, GoNoGoSnapshot } from "./GoNoGoHostService";

const GoNoGoHostContext = createContext<GoNoGoHostService | null>(null);

export function GoNoGoHostProvider({
  service,
  children,
}: {
  service: GoNoGoHostService;
  children: ReactNode;
}) {
  return (
    <GoNoGoHostContext.Provider value={service}>
      {children}
    </GoNoGoHostContext.Provider>
  );
}

/**
 * Returns the host service, or null if no provider is mounted. The
 * component uses this: on station screens there's no host aggregator so
 * the hook returning null is how the component knows to render its
 * station-mode UI.
 */
export function useGoNoGoHost(): GoNoGoHostService | null {
  return useContext(GoNoGoHostContext);
}

/** Reactive snapshot: re-renders on any state change. */
export function useGoNoGoSnapshot(): GoNoGoSnapshot | null {
  const service = useGoNoGoHost();
  const [snapshot, setSnapshot] = useState<GoNoGoSnapshot | null>(() =>
    service ? service.getSnapshot() : null,
  );
  useEffect(() => {
    if (!service) {
      setSnapshot(null);
      return;
    }
    setSnapshot(service.getSnapshot());
    return service.subscribe(() => setSnapshot(service.getSnapshot()));
  }, [service]);
  return snapshot;
}
