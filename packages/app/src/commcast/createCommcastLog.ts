import type { PeerHostService } from "../peer/PeerHostService";
import { getStationKey } from "../peer/stationPeerId";
import { CommcastLog, type CommcastLogOptions } from "./CommcastLog";
import { CommcastMesh } from "./CommcastMesh";

/**
 * The host screen's own log, attached to the mesh it routes.
 *
 * Built at screen level rather than in the widget because a message addressed
 * here arrives whether or not the tile is on the dashboard, and because the
 * relay has to run for the other stations even when nobody at this screen is
 * looking at Commcast at all.
 *
 * What it deliberately does NOT do is push anything on `onPeerConnect`. The
 * connect-time snapshot was the load-bearing half of the host-authoritative
 * thread, and it is exactly the behaviour being removed: handing a station the
 * host's log would make the host the owner of messages that never reached that
 * station, which is the central store the model rejects. A participant who was
 * away missed what was said, the same way they would have on a radio.
 */
export function createCommcastLog(
  host: PeerHostService | null,
  opts: Partial<CommcastLogOptions> = {},
): CommcastLog {
  const screenKey = opts.screenKey ?? getStationKey();
  const log = new CommcastLog({ ...opts, screenKey });
  if (!host) return log;
  const mesh = CommcastMesh.forHost(host, screenKey, {
    onMessage: (msg) => log.receiveTransmission(msg),
    onAck: (ack) => log.receiveAck(ack),
  });
  log.setTransmitter(mesh);
  return log;
}
