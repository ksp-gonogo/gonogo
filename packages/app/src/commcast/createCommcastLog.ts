import type { PeerHostService } from "../peer/PeerHostService";
import { getStationKey } from "../peer/stationPeerId";
import { CommcastLog, type CommcastLogOptions } from "./CommcastLog";
import { CommcastMesh } from "./CommcastMesh";

/**
 * The host screen's own log.
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
 *
 * **Constructing the log and joining the mesh are two calls now, and that is
 * the whole point.** This one is pure: it reads storage, registers nothing and
 * can be called any number of times without leaving a mark, which is what makes
 * it safe in a `useState` initialiser. Joining the mesh is
 * {@link attachCommcastHostMesh}, which registers listeners and therefore has
 * to be owned by an effect that can undo it.
 */
export function createCommcastLog(
  opts: Partial<CommcastLogOptions> = {},
): CommcastLog {
  return new CommcastLog({
    ...opts,
    screenKey: opts.screenKey ?? getStationKey(),
  });
}

/**
 * Put `log` on the mesh as the HOST end, and return the way back off it.
 *
 * Separate from the constructor because it registers listeners on the peer
 * host, and a registration with no disposal path is the defect this shape
 * exists to prevent. It was previously done inside the same call, from inside a
 * `useState` initialiser, and React invokes those more than once: every extra
 * invocation left a live undisposed mesh on `onCommcastRadio`, and a host mesh
 * REPEATS what it hears. The host's own log stayed correct, because each leaked
 * mesh delivered to its own orphan log rather than to the rendered one, so the
 * only symptom was on the wire: a station keying once put four copies of every
 * chunk in front of every other peer, and a chunk has no id for anything
 * downstream to dedupe on. Measured at four copies; the count moved with how
 * many times the screen happened to mount.
 *
 * A host-authored transmission cannot show this and never did. The host sends
 * by calling `host.broadcast` directly, once per keying, so the duplication
 * lives only on the path a PEER's frame takes.
 */
export function attachCommcastHostMesh(
  log: CommcastLog,
  host: PeerHostService,
): () => void {
  const mesh = CommcastMesh.forHost(host, log.screenKey, {
    onMessage: (msg) => log.receiveTransmission(msg),
    onAck: (ack) => log.receiveAck(ack),
    onRadio: (frame) => log.receiveRadio(frame),
  });
  log.setTransmitter(mesh);
  return () => {
    log.setTransmitter(undefined);
    mesh.dispose();
  };
}
