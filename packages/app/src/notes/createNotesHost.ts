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
  // Re-broadcast on every change. Initial snapshot also goes out so a
  // station that connects after the host has notes already gets them on
  // hello+snapshot rather than waiting for the next mutation.
  service.subscribe((snap) => bridge.broadcastSnapshot(snap));
  bridge.broadcastSnapshot(service.snapshot());
  return service;
}
