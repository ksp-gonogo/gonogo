import type { PeerHostService } from "../peer/PeerHostService";
import type { NotesSnapshot } from "./types";

export interface NotesPeerBridgeHandlers {
  addNote(input: { body: string; createdBy?: string }): void;
  updateNote(id: string, body: string): void;
  deleteNote(id: string): void;
  reorderNote(id: string, afterId: string | null): void;
}

/**
 * Wires station-originated note mutations into the host service and
 * exposes `broadcastSnapshot` for the host to call when state changes.
 * No notes state lives here — it's pure event plumbing in the same
 * style as AlarmPeerBridge.
 */
export class NotesPeerBridge {
  constructor(
    private readonly host: PeerHostService | null,
    handlers: NotesPeerBridgeHandlers,
  ) {
    if (!host) return;
    host.onNoteAdd((peerId, msg) => {
      handlers.addNote({ body: msg.body, createdBy: peerId });
    });
    host.onNoteUpdate((_peerId, msg) => {
      handlers.updateNote(msg.id, msg.body);
    });
    host.onNoteDelete((_peerId, id) => {
      handlers.deleteNote(id);
    });
    host.onNoteReorder((_peerId, msg) => {
      handlers.reorderNote(msg.id, msg.afterId);
    });
  }

  broadcastSnapshot(snapshot: NotesSnapshot): void {
    this.host?.broadcast({ type: "notes-snapshot", snapshot });
  }
}
