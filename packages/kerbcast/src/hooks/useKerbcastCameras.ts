import { getDataSource } from "@gonogo/core";
import type { CameraState } from "@jonpepler/kerbcast";
import { useEffect, useState } from "react";
import type { KerbcastDataSource } from "../KerbcastDataSource";

/**
 * Live snapshot of the kerbcast camera registry. Returns the empty
 * list before the data channel handshake completes (and after a
 * disconnect). Subscribes via the underlying `KerbcastClient`'s
 * `cameras-change` event for one synchronous push per server-side
 * snapshot or state-changed message.
 */
export function useKerbcastCameras(): CameraState[] {
  const [cameras, setCameras] = useState<CameraState[]>(() => {
    const ds = getDataSource("kerbcast") as KerbcastDataSource | undefined;
    return ds ? [...ds.getClient().cameras] : [];
  });

  useEffect(() => {
    const ds = getDataSource("kerbcast") as KerbcastDataSource | undefined;
    if (!ds) return;
    // A mounted camera widget wants the source connected so the camera list can
    // arrive — the lazy connect trigger (no-op once connected, e.g. on the main
    // screen). Without this a brokered station never connects: no list → no
    // selected camera → no per-camera subscribe → no connection.
    ds.ensureConnected();
    const client = ds.getClient();
    setCameras([...client.cameras]);
    return client.on("cameras-change", (next) => setCameras([...next]));
  }, []);

  return cameras;
}
