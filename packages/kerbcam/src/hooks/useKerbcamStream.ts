import { getDataSource } from "@gonogo/core";
import { useEffect, useState } from "react";
import type { KerbcamDataSource } from "../KerbcamDataSource";

/**
 * Live `MediaStream` for one kerbcam camera. Returns `null` while
 * the WebRTC track hasn't arrived yet (during connection setup, or
 * after a disconnect). Components bind the stream to a `<video>`'s
 * `srcObject` directly.
 *
 * The `getDataSource()` reach-around is intentional and matches the
 * @gonogo/data pattern for non-value channels — `useDataValue` is
 * scalar-only.
 */
export function useKerbcamStream(flightId: number | null): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(() => {
    if (flightId === null) return null;
    const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    return ds?.getConnection().getStream(flightId) ?? null;
  });

  useEffect(() => {
    if (flightId === null) {
      setStream(null);
      return;
    }
    const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    if (!ds) return;
    const conn = ds.getConnection();
    setStream(conn.getStream(flightId));
    return conn.onStreamChange(flightId, setStream);
  }, [flightId]);

  return stream;
}
