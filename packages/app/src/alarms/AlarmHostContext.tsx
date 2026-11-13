import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { EMPTY_SNAPSHOT } from "./AlarmClientService";
import type { AlarmHostService } from "./AlarmHostService";
import type { AlarmSnapshot } from "./types";

/**
 * What the alarm banner, the alarms modal and the warp control call. The host's
 * own service satisfies it, and so does `AlarmClientService` on a screen that
 * reads the list from a host over the peer link.
 */
export interface AlarmService {
  snapshot(): AlarmSnapshot;
  subscribe(cb: (snap: AlarmSnapshot) => void): () => void;
  addAlarm(input: Parameters<AlarmHostService["addAlarm"]>[0]): unknown;
  updateAlarm(
    id: string,
    patch: Parameters<AlarmHostService["updateAlarm"]>[1],
  ): void;
  deleteAlarm(id: string): void;
  acknowledgeAlarm(id: string): void;
  acknowledgeUnscheduledWarp(): void;
  acknowledgeAlarmsCancelled(): void;
  announceWarpIntent(): void;
  beginWarpTo(): void;
  beginWarpToFirstSignal(): void;
  cancelWarpTo(): void;
  setWarpSafetyMargin(seconds: number): void;
}

/** An alarm list that is always empty and takes every change as a no-op, for a screen with neither a host of its own nor one to read from. */
export const NO_ALARM_SERVICE: AlarmService = {
  snapshot: () => EMPTY_SNAPSHOT,
  subscribe: () => () => {},
  addAlarm: () => undefined,
  updateAlarm: () => {},
  deleteAlarm: () => {},
  acknowledgeAlarm: () => {},
  acknowledgeUnscheduledWarp: () => {},
  acknowledgeAlarmsCancelled: () => {},
  announceWarpIntent: () => {},
  beginWarpTo: () => {},
  beginWarpToFirstSignal: () => {},
  cancelWarpTo: () => {},
  setWarpSafetyMargin: () => {},
};

const AlarmHostContext = createContext<AlarmService | null>(null);

export function AlarmHostProvider({
  service,
  children,
}: {
  service: AlarmService;
  children: ReactNode;
}) {
  return (
    <AlarmHostContext.Provider value={service}>
      {children}
    </AlarmHostContext.Provider>
  );
}

export function useAlarmHost(): AlarmService {
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
