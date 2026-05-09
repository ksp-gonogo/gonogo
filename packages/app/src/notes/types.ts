/**
 * Mission notes — free-text entries that sync across the host and every
 * connected station. Templated tags `{{key.path}}` are replaced with the
 * live value from the data feed at render time (resolved on each device,
 * not on the host, so the substitution stays current with whatever data
 * source the consumer cares about).
 */

export interface Note {
  id: string;
  body: string;
  /** Display order — lower renders first. Densely packed, gaps fine. */
  order: number;
  /** Wall-clock ms when first created. */
  createdAt: number;
  /** Wall-clock ms of the most recent body / order edit. */
  updatedAt: number;
  /** PeerId of the author for attribution. Optional — host edits omit it. */
  createdBy?: string;
}

export interface NotesSnapshot {
  notes: readonly Note[];
}

export const EMPTY_NOTES_SNAPSHOT: NotesSnapshot = { notes: [] };
