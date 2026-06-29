import { getDataSource } from "@gonogo/core";
import { useEffect, useState } from "react";
import type { KerbcastDataSource } from "../KerbcastDataSource";

/**
 * Live `MediaStream` for one kerbcast camera. Returns `null` while
 * the WebRTC track hasn't arrived yet (during connection setup, or
 * after a disconnect). Components bind the stream to a `<video>`'s
 * `srcObject` directly.
 *
 * Works on both screens. The main screen connects to the sidecar directly; a
 * station uses the brokered data source (`KerbcastDataSource.attachBroker`) — the
 * offer→answer relays through the host, but media flows station↔sidecar
 * directly, so the `MediaStream` itself never crosses PeerJS.
 */
export function useKerbcastStream(flightId: number | null): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(() => {
    if (flightId === null) return null;
    const ds = getDataSource("kerbcast") as KerbcastDataSource | undefined;
    return ds?.getClient().camera(flightId).mediaStream ?? null;
  });

  useEffect(() => {
    if (flightId === null) {
      setStream(null);
      return;
    }
    const ds = getDataSource("kerbcast") as KerbcastDataSource | undefined;
    if (!ds) return;
    const cam = ds.getClient().camera(flightId);
    setStream(cam.mediaStream);
    const off = cam.on("stream", setStream);
    // Bind a slot for this camera while it's on screen; release it on unmount /
    // camera switch. The data source refcounts, so several widgets showing the
    // same camera share one slot.
    ds.subscribeCamera(flightId);
    return () => {
      off();
      ds.unsubscribeCamera(flightId);
    };
  }, [flightId]);

  return stream;
}
