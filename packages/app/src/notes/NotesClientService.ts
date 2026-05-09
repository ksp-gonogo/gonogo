import type { PeerClientService } from "../peer/PeerClientService";
import { EMPTY_NOTES_SNAPSHOT, type NotesSnapshot } from "./types";

type Listener = (snap: NotesSnapshot) => void;

/**
 * Station-side mirror of NotesHostService. Receives the canonical
 * snapshot from the host and exposes the same mutator surface widgets
 * call on either screen. Mutations send peer messages; the next snapshot
 * round-trip is what actually updates local state.
 */
export class NotesClientService {
  private current: NotesSnapshot = EMPTY_NOTES_SNAPSHOT;
  private listeners = new Set<Listener>();

  constructor(private readonly client: PeerClientService) {
    this.client.onNotesSnapshot((snap) => {
      this.current = snap;
      for (const cb of this.listeners) cb(snap);
    });
  }

  snapshot(): NotesSnapshot {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addNote(body: string): void {
    this.client.sendNoteAdd(body);
  }

  updateNote(id: string, body: string): void {
    this.client.sendNoteUpdate(id, body);
  }

  deleteNote(id: string): void {
    this.client.sendNoteDelete(id);
  }

  reorderNote(id: string, afterId: string | null): void {
    this.client.sendNoteReorder(id, afterId);
  }
}
