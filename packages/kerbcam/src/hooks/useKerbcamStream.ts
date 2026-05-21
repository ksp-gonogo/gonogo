import { getDataSource } from "@gonogo/core";
import { useEffect, useState } from "react";
import type { KerbcamDataSource } from "../KerbcamDataSource";

/**
 * Live `MediaStream` for one kerbcam camera. Returns `null` while
 * the WebRTC track hasn't arrived yet (during connection setup, or
 * after a disconnect). Components bind the stream to a `<video>`'s
 * `srcObject` directly.
 *
 * Reaches into the `KerbcamClient` via `getDataSource` because the
 * default `useDataValue` channel is scalar-only.
 */
export function useKerbcamStream(flightId: number | null): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(() => {
    if (flightId === null) return null;
    const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    return ds?.getClient().camera(flightId).mediaStream ?? null;
  });

  useEffect(() => {
    if (flightId === null) {
      setStream(null);
      return;
    }
    const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    if (!ds) return;
    const cam = ds.getClient().camera(flightId);
    setStream(cam.mediaStream);
    return cam.on("stream", setStream);
  }, [flightId]);

  return stream;
}
