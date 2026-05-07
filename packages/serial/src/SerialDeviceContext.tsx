import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { SerialDeviceService } from "./SerialDeviceService";

const SerialDeviceContext = createContext<SerialDeviceService | null>(null);

export function SerialDeviceProvider({
  service,
  children,
}: {
  service: SerialDeviceService;
  children: ReactNode;
}) {
  return (
    <SerialDeviceContext.Provider value={service}>
      {children}
    </SerialDeviceContext.Provider>
  );
}

export function useSerialDeviceService(): SerialDeviceService {
  const svc = useContext(SerialDeviceContext);
  if (!svc) {
    throw new Error(
      "useSerialDeviceService must be used inside a <SerialDeviceProvider>.",
    );
  }
  return svc;
}

/**
 * Reactive view of the current device instances. Re-renders when devices
 * are added/removed or when an instance's config changes.
 */
export function useSerialDevices() {
  const svc = useSerialDeviceService();
  const [snapshot, setSnapshot] = useState(() => svc.getDevices());
  useEffect(
    () => svc.onDevicesChange(() => setSnapshot(svc.getDevices())),
    [svc],
  );
  return snapshot;
}

/** Reactive view of the registered device types. */
export function useSerialDeviceTypes() {
  const svc = useSerialDeviceService();
  const [snapshot, setSnapshot] = useState(() => svc.getDeviceTypes());
  useEffect(
    () => svc.onDeviceTypesChange(() => setSnapshot(svc.getDeviceTypes())),
    [svc],
  );
  return snapshot;
}

/** Reactive view of a single device's transport status. */
export function useSerialDeviceStatus(deviceId: string) {
  const svc = useSerialDeviceService();
  const [status, setStatus] = useState(() => svc.getStatus(deviceId));
  useEffect(
    () =>
      svc.onStatusChange((id, next) => {
        if (id === deviceId) setStatus(next);
      }),
    [svc, deviceId],
  );
  return status;
}

export type SerialAggregateStatus =
  | "idle" // no web-serial devices registered
  | "connected" // every web-serial device connected
  | "partial" // some web-serial devices disconnected
  | "error"; // at least one web-serial device errored

/**
 * Aggregate connectivity across every registered web-serial device on this
 * screen. Virtual devices are excluded — they don't represent physical
 * connections, so they'd skew the headline. Used by the joystick FAB to
 * surface a "controller dropped" hint without the user having to open the
 * Devices menu.
 */
export function useSerialAggregateStatus(): SerialAggregateStatus {
  const svc = useSerialDeviceService();
  const [status, setStatus] = useState<SerialAggregateStatus>(() =>
    computeAggregate(svc),
  );
  useEffect(() => {
    const recompute = () => setStatus(computeAggregate(svc));
    const offStatus = svc.onStatusChange(recompute);
    const offDevices = svc.onDevicesChange(recompute);
    recompute();
    return () => {
      offStatus();
      offDevices();
    };
  }, [svc]);
  return status;
}

/**
 * Reactive view of the pending-port-choice list — saved devices that need
 * the user to pick between two or more matching ports. Empty almost all
 * the time; only fills when autoReconnect found ambiguous candidates.
 */
export function useSerialPendingChoices(): ReadonlyMap<
  string,
  readonly SerialPort[]
> {
  const svc = useSerialDeviceService();
  const [snap, setSnap] = useState<ReadonlyMap<string, readonly SerialPort[]>>(
    () => new Map(svc.getPendingChoices()),
  );
  useEffect(() => {
    return svc.onPendingChoicesChange(() => {
      setSnap(new Map(svc.getPendingChoices()));
    });
  }, [svc]);
  return snap;
}

function computeAggregate(svc: SerialDeviceService): SerialAggregateStatus {
  const devices = svc.getDevices().filter((d) => d.transport === "web-serial");
  if (devices.length === 0) return "idle";
  let anyError = false;
  let anyDisconnected = false;
  for (const d of devices) {
    const s = svc.getStatus(d.id);
    if (s === "error") anyError = true;
    else if (s !== "connected") anyDisconnected = true;
  }
  if (anyError) return "error";
  if (anyDisconnected) return "partial";
  return "connected";
}
