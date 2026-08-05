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

/**
 * Like `useAlarmSnapshot`, but returns `null` instead of throwing when there is
 * no `AlarmHostProvider` in the tree. The status bridge lives inside every grid
 * item, including screens and tests that never mount an alarm host, so it must
 * degrade to "no alarms" rather than crash.
 */
export function useAlarmSnapshotOptional(): AlarmSnapshot | null {
  const svc = useContext(AlarmHostContext);
  const [snap, setSnap] = useState<AlarmSnapshot | null>(() =>
    svc ? svc.snapshot() : null,
  );
  useEffect(() => {
    if (!svc) return;
    setSnap(svc.snapshot());
    return svc.subscribe(setSnap);
  }, [svc]);
  return svc ? snap : null;
}
