import { logger } from "@ksp-gonogo/logger";
import type { StationBroker } from "@ksp-gonogo/sitrep-sdk";
import { watchStationBrokers } from "@ksp-gonogo/sitrep-sdk/registry";
import type { PeerClientService } from "../peer/PeerClientService";

type BrokerClient = Pick<
  PeerClientService,
  "sendUplinkRelay" | "onConnectionStatus" | "getConnStatus"
>;

const NO_ICE_SERVERS: StationBroker["iceServers"] = {
  current: () => [],
  onChange: () => () => {},
};

/**
 * Hand every Uplink that registered a station broker one bound to its own id,
 * relaying through this station's link to the main screen, until the returned
 * function is called.
 *
 * One Uplink's attach throwing is logged and skipped rather than propagated, so
 * it cannot stop the next Uplink's from running. Each broker's `onLinkReset`
 * fires when the station's link comes back after it was lost.
 */
export function attachStationBrokers(client: BrokerClient): () => void {
  const resets = new Set<() => void>();
  let connected = client.getConnStatus() === "connected";
  let lost = false;
  const stopStatus = client.onConnectionStatus((status) => {
    if (status !== "connected") {
      if (connected) lost = true;
      connected = false;
      return;
    }
    connected = true;
    if (!lost) return;
    lost = false;
    for (const cb of [...resets]) {
      try {
        cb();
      } catch (err) {
        logger.warn("[stationBrokers] a link reset listener threw", {
          error: err,
        });
      }
    }
  });
  const onLinkReset = (cb: () => void) => {
    resets.add(cb);
    return () => {
      resets.delete(cb);
    };
  };
  const stopWatching = watchStationBrokers((uplinkId, attach) => {
    try {
      attach({
        relay: (method, args) => client.sendUplinkRelay(uplinkId, method, args),
        iceServers: NO_ICE_SERVERS,
        onLinkReset,
      });
    } catch (err) {
      logger.warn(`[stationBrokers] "${uplinkId}" failed to attach`, {
        error: err,
      });
    }
  });
  return () => {
    stopWatching();
    stopStatus();
    resets.clear();
  };
}
