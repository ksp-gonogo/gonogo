import { getDataSource } from "@gonogo/core";
import type { CameraState } from "@jonpepler/kerbcam";
import { useEffect, useState } from "react";
import type { KerbcamDataSource } from "../KerbcamDataSource";

/**
 * Live snapshot of the kerbcam camera registry. Returns the empty
 * list before the data channel handshake completes (and after a
 * disconnect). Stable identity guarantee per `CameraState` — the
 * connection layer assembles a fresh array on every push but the
 * elements themselves are immutable per state-change, so React
 * memoisation keyed on `flightId` works.
 *
 * Internally reaches into the registry to find the kerbcam source
 * and subscribe to its `onCamerasChange` push. The DataSource
 * interface's `subscribe(key, cb)` works too but burns one extra
 * `queueMicrotask` per render; this is the direct path.
 */
export function useKerbcamCameras(): CameraState[] {
  const [cameras, setCameras] = useState<CameraState[]>(() => {
    const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    return ds?.getConnection().getCameras() ?? [];
  });

  useEffect(() => {
    const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    if (!ds) return;
    const conn = ds.getConnection();
    // Replay current value in case it changed between the initial
    // useState read and the effect attaching.
    setCameras(conn.getCameras());
    return conn.onCamerasChange(setCameras);
  }, []);

  return cameras;
}
