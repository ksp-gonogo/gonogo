import type { PeerHostService } from "../peer/PeerHostService";
import { NotesHostService } from "./NotesHostService";
import { NotesPeerBridge } from "./NotesPeerBridge";

/**
 * Wires a NotesHostService to the peer host so station mutations route
 * through the public mutator API and snapshot changes broadcast to every
 * connected station. Returns the service so the caller can hand it to
 * <NotesHostProvider>. The bridge has no public API after construction.
 */
export function createNotesHost(
  host: PeerHostService | null,
): NotesHostService {
  const service = new NotesHostService();
  const bridge = new NotesPeerBridge(host, {
    addNote: (input) => service.addNote(input),
    updateNote: (id, body) => service.updateNote(id, body),
    deleteNote: (id) => service.deleteNote(id),
    reorderNote: (id, afterId) => service.reorderNote(id, afterId),
  });
  // Re-broadcast on every change.
  service.subscribe((snap) => bridge.broadcastSnapshot(snap));
  // Initial broadcast also fires so a station that's already connected at
  // host startup gets the snapshot. But broadcast() only reaches currently
  // connected peers — a station that joins LATER misses this. So we also
  // push a fresh snapshot to each new peer on connect (the user-reported
  // bug: first-load station notes widget showed empty until a mutation).
  bridge.broadcastSnapshot(service.snapshot());
  host?.onPeerConnect((peerId) => {
    host.sendToPeer(peerId, {
      type: "notes-snapshot",
      snapshot: service.snapshot(),
    });
  });
  return service;
}
