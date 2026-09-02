import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import { useEffect } from "react";
import { useStationName } from "../stationIdentity";
import { BUILD_TIME, VERSION } from "../version";
import type { PeerClientService } from "./PeerClientService";

/**
 * Tells the host who this peer is, and re-tells it on every reconnect and
 * rename.
 *
 * The `seat` is what makes a shared thread's light-time computable: without it
 * the host cannot say which end of the path a message was spoken from, and a
 * message whose seat is unknown cannot be delayed at all. It rides here rather
 * than being inferred host-side because the peer is the only one that knows.
 */
export function StationInfoBroadcaster({
  client,
  seat,
}: {
  client: PeerClientService;
  seat: Seat;
}) {
  const name = useStationName();
  useEffect(() => {
    const send = () =>
      client.sendStationInfo(name, {
        version: VERSION,
        buildTime: BUILD_TIME,
        seat,
      });
    const unsub = client.onConnectionStatus((status) => {
      if (status === "connected") send();
    });
    // Fire once immediately in case we're already connected by the time
    // this effect runs (or the name changes while connected).
    send();
    return () => {
      unsub();
    };
  }, [client, name, seat]);
  return null;
}
