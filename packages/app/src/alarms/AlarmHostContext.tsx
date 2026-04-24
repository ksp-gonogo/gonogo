import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { AlarmHostService } from "./AlarmHostService";
import type { AlarmSnapshot } from "./types";

const AlarmHostContext = createContext<AlarmHostService | null>(null);

export function AlarmHostProvider({
  service,
  children,
}: {
  service: AlarmHostService;
  children: ReactNode;
}) {
  return (
    <AlarmHostContext.Provider value={service}>
      {children}
    </AlarmHostContext.Provider>
  );
}

export function useAlarmHost(): AlarmHostService {
  const svc = useContext(AlarmHostContext);
  if (!svc) {
    throw new Error("useAlarmHost must be used inside an <AlarmHostProvider>");
  }
  return svc;
}

/** Reactive snapshot for React consumers. Updates on every host emit. */
export function useAlarmSnapshot(): AlarmSnapshot {
  const svc = useAlarmHost();
  const [snap, setSnap] = useState(() => svc.snapshot());
  useEffect(() => svc.subscribe(setSnap), [svc]);
  return snap;
}
