import type { PeerClient } from "../peer/PeerClientContext";
import {
  EMPTY_NOTES_SNAPSHOT,
  type NoteOutcome,
  type NotesSnapshot,
} from "./types";

type Listener = (snap: NotesSnapshot) => void;
type Pending = (outcome: NoteOutcome) => void;

/**
 * Station-side mirror of NotesHostService. Receives the list of the command
 * centre the station stands at and exposes the same mutator surface widgets
 * call on either screen. A change goes to the host and settles when the host
 * answers; the list itself only changes when the next snapshot arrives. A
 * change made while the connection is down settles at once as `offline`, so
 * the caller can keep what the operator typed.
 */
export class NotesClientService {
  private current: NotesSnapshot = EMPTY_NOTES_SNAPSHOT;
  private listeners = new Set<Listener>();
  private pending = new Map<string, Pending>();
  private nextRef = 0;

  constructor(private readonly client: PeerClient) {
    this.client.onNotesSnapshot((snap) => {
      this.current = snap;
      for (const cb of this.listeners) cb(snap);
    });
    this.client.onNoteResult((msg) => {
      const settle = this.pending.get(msg.ref);
      if (!settle) return;
      this.pending.delete(msg.ref);
      settle(
        msg.ok
          ? { status: "ok" }
          : { status: "refused", current: msg.current ?? null },
      );
    });
    // A change in flight when the link drops will never be answered.
    this.client.onConnectionStatus((status) => {
      if (status === "connected") return;
      for (const settle of this.pending.values()) settle({ status: "offline" });
      this.pending.clear();
    });
  }

  snapshot(): NotesSnapshot {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether a change would reach the host right now. */
  isConnected(): boolean {
    return this.client.getConnStatus() === "connected";
  }

  addNote(body: string): Promise<NoteOutcome> {
    return this.send((ref) => this.client.sendNoteAdd(ref, body));
  }

  updateNote(
    id: string,
    body: string,
    baseVersion: number,
  ): Promise<NoteOutcome> {
    return this.send((ref) =>
      this.client.sendNoteUpdate(ref, id, body, baseVersion),
    );
  }

  deleteNote(id: string, baseVersion: number): Promise<NoteOutcome> {
    return this.send((ref) => this.client.sendNoteDelete(ref, id, baseVersion));
  }

  reorderNote(
    id: string,
    afterId: string | null,
    baseVersion: number,
  ): Promise<NoteOutcome> {
    return this.send((ref) =>
      this.client.sendNoteReorder(ref, id, afterId, baseVersion),
    );
  }

  private send(transmit: (ref: string) => boolean): Promise<NoteOutcome> {
    const ref = `n${this.nextRef++}`;
    return new Promise((resolve) => {
      this.pending.set(ref, resolve);
      if (!transmit(ref)) {
        this.pending.delete(ref);
        resolve({ status: "offline" });
      }
    });
  }
}
