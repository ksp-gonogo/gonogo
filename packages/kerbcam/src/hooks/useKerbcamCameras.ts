import { getDataSource } from "@gonogo/core";
import type { CameraState } from "@jonpepler/kerbcam";
import { useEffect, useState } from "react";
import type { KerbcamDataSource } from "../KerbcamDataSource";

/**
 * Live snapshot of the kerbcam camera registry. Returns the empty
 * list before the data channel handshake completes (and after a
 * disconnect). Subscribes via the underlying `KerbcamClient`'s
 * `cameras-change` event for one synchronous push per server-side
 * snapshot or state-changed message.
 */
export function useKerbcamCameras(): CameraState[] {
  const [cameras, setCameras] = useState<CameraState[]>(() => {
    const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    return ds ? [...ds.getClient().cameras] : [];
  });

  useEffect(() => {
    const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    if (!ds) return;
    const client = ds.getClient();
    setCameras([...client.cameras]);
    return client.on("cameras-change", (next) => setCameras([...next]));
  }, []);

  return cameras;
}
