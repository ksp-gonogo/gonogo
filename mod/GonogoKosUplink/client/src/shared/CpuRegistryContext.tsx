import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { CpuRegistryService, KosCpuEntry } from "./CpuRegistryService";

const CpuRegistryContext = createContext<CpuRegistryService | null>(null);

export function CpuRegistryProvider({
  service,
  children,
}: {
  service: CpuRegistryService;
  children: ReactNode;
}) {
  return (
    <CpuRegistryContext.Provider value={service}>
      {children}
    </CpuRegistryContext.Provider>
  );
}

/**
 * Imperative handle for code paths that need to add/remove entries.
 * Most consumers should prefer {@link useCpuRegistry} for a reactive
 * snapshot of the current entry list.
 */
export function useCpuRegistryService(): CpuRegistryService {
  const svc = useContext(CpuRegistryContext);
  if (!svc) {
    throw new Error(
      "useCpuRegistryService must be used inside <CpuRegistryProvider>",
    );
  }
  return svc;
}

/**
 * Reactive snapshot of the registry. Re-renders the consumer whenever
 * any entry is added, edited, removed, or stamped by discovery.
 */
export function useCpuRegistry(): readonly KosCpuEntry[] {
  const svc = useCpuRegistryService();
  const [entries, setEntries] = useState(() => svc.list());
  useEffect(() => svc.subscribe(() => setEntries(svc.list())), [svc]);
  return entries;
}
