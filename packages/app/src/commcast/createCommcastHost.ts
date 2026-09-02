import type { PeerHostService } from "../peer/PeerHostService";
import {
  type CommcastHostOptions,
  CommcastHostService,
} from "./CommcastHostService";
import { CommcastPeerBridge } from "./CommcastPeerBridge";

/**
 * Wires a `CommcastHostService` to the peer host: peer messages route through
 * the service's public API, and every change broadcasts to each connected
 * peer. Returns the service so the caller can hand it to a provider.
 *
 * The connect-time push is the load-bearing half and is copied from
 * `createNotesHost` deliberately: `broadcast()` only reaches peers connected
 * RIGHT NOW, so without a per-peer snapshot on connect a message spoken while
 * someone was away would never reach them. For a thread whose whole premise is
 * that the other person is minutes away and may well be offline, that is the
 * difference between a message channel and a live-only one.
 */
export function createCommcastHost(
  host: PeerHostService | null,
  opts: CommcastHostOptions = {},
): CommcastHostService {
  const service = new CommcastHostService(opts);
  const bridge = new CommcastPeerBridge(host, {
    post: (author, input) => service.post(author, input),
    markRead: (reader, ids, atUt) => service.markRead(reader, ids, atUt),
    noteParticipant: (participant) => service.noteParticipant(participant),
  });
  service.subscribe((snap) => bridge.broadcastSnapshot(snap));
  // Reaches anyone already connected when the host screen mounts.
  bridge.broadcastSnapshot(service.snapshot());
  host?.onPeerConnect((peerId) => {
    host.sendToPeer(peerId, {
      type: "commcast-snapshot",
      snapshot: service.snapshot(),
    });
  });
  return service;
}
