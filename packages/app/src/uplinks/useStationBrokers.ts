import { useEffect } from "react";
import type { PeerClientService } from "../peer/PeerClientService";
import { attachStationBrokers } from "./stationBrokers";

/**
 * Hands every Uplink that registered a station broker one relaying through
 * `client`, for as long as the calling screen is mounted, including an Uplink
 * whose bundle registers later. Every screen that joins a main screen as a
 * station calls it, so an Uplink reaches the main screen the same way from each.
 */
export function useStationBrokers(client: PeerClientService): void {
  useEffect(() => attachStationBrokers(client), [client]);
}
