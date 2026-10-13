/**
 * Mission notes: free-text entries kept per command centre. Every screen at a
 * centre sees the same list; a screen at another centre sees that centre's.
 * Templated tags `{{key.path}}` are replaced with the live value from the data
 * feed at render time (resolved on each device, not on the host, so the
 * substitution stays current with whatever data source the consumer cares
 * about).
 */

export interface Note {
  id: string;
  body: string;
  /** Display order: lower renders first. Densely packed, gaps fine. */
  order: number;
  /**
   * Counts the edits that changed this note's body or moved it. A change is
   * accepted only against the version the sender last saw.
   */
  version: number;
  /** Wall-clock ms when first created. */
  createdAt: number;
  /** Wall-clock ms of the most recent body / order edit. */
  updatedAt: number;
  /** PeerId of the author for attribution. Optional, host edits omit it. */
  createdBy?: string;
}

export interface NotesSnapshot {
  /** The command centre this list belongs to; null while a screen has none. */
  centreId: string | null;
  notes: readonly Note[];
}

export const EMPTY_NOTES_SNAPSHOT: NotesSnapshot = {
  centreId: null,
  notes: [],
};

/**
 * What became of a note change. `refused` carries the note as the list now
 * holds it, or null when it was deleted; `offline` means it never left this
 * device.
 */
export type NoteOutcome =
  | { status: "ok" }
  | { status: "refused"; current: Note | null }
  | { status: "offline" };
