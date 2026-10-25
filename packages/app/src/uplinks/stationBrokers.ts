import { logger } from "@ksp-gonogo/logger";
import type { StationBroker } from "@ksp-gonogo/sitrep-sdk";
import { watchStationBrokers } from "@ksp-gonogo/sitrep-sdk/registry";
import type { PeerClientService } from "../peer/PeerClientService";

type BrokerClient = Pick<PeerClientService, "sendUplinkRelay">;

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
 * it cannot stop the next Uplink's from running.
 */
export function attachStationBrokers(client: BrokerClient): () => void {
  return watchStationBrokers((uplinkId, attach) => {
    try {
      attach({
        relay: (method, args) => client.sendUplinkRelay(uplinkId, method, args),
        iceServers: NO_ICE_SERVERS,
      });
    } catch (err) {
      logger.warn(`[stationBrokers] "${uplinkId}" failed to attach`, {
        error: err,
      });
    }
  });
}
