import type { PeerHostService } from "../peer/PeerHostService";
import { NotesHostService } from "./NotesHostService";
import { NotesPeerBridge } from "./NotesPeerBridge";

/**
 * Wires a NotesHostService to the peer host so station mutations route
 * through the public mutator API and each change reaches the stations at the
 * centre it belongs to. Returns the service so the caller can hand it to
 * <NotesHostProvider>. The bridge has no public API after construction.
 */
export function createNotesHost(
  host: PeerHostService | null,
): NotesHostService {
  const service = new NotesHostService();
  const bridge = new NotesPeerBridge(host, {
    snapshotFor: (centreId) => service.snapshot(centreId),
    addNote: (centreId, input) => service.addNote(centreId, input),
    updateNote: (centreId, id, body, v) =>
      service.updateNote(centreId, id, body, v),
    deleteNote: (centreId, id, v) => service.deleteNote(centreId, id, v),
    reorderNote: (centreId, id, afterId, v) =>
      service.reorderNote(centreId, id, afterId, v),
  });
  service.onDispose(
    service.subscribe((snap) => bridge.broadcastSnapshot(snap)),
  );
  service.onDispose(() => bridge.dispose());
  return service;
}
