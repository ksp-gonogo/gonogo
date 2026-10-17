import { safeRandomUuid } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { EMPTY_NOTES_SNAPSHOT, type Note, type NotesSnapshot } from "./types";

const STORAGE_KEY = "gonogo.notes.v2";

type Listener = (snap: NotesSnapshot) => void;

export type NoteResult = { ok: true } | { ok: false; current: Note | null };

/**
 * Main-screen owner of the mission notes, one list per command centre. Holds
 * the canonical state, persists to localStorage so notes survive a refresh,
 * and emits the changed centre's snapshot to subscribers. The peer bridge fans
 * a snapshot out to the stations at that centre and routes their changes back
 * through the public mutator API.
 *
 * A change to an existing note names the version the sender last saw and is
 * refused when the note has moved on, so a second edit never silently replaces
 * the first.
 */
export class NotesHostService {
  private centres = new Map<string, Note[]>();
  private listeners = new Set<Listener>();
  private teardowns: Array<() => void> = [];
  private nowFn: () => number;

  constructor(
    opts: {
      now?: () => number;
      /** Seeds the lists, keyed by centre id; replaces what storage holds. */
      load?: () => Record<string, Note[]> | null;
    } = {},
  ) {
    this.nowFn = opts.now ?? (() => Date.now());
    const loaded = opts.load ? opts.load() : this.loadFromStorage();
    if (loaded) {
      for (const [centreId, notes] of Object.entries(loaded)) {
        this.centres.set(centreId, [...notes]);
      }
    }
  }

  snapshot(centreId: string | null): NotesSnapshot {
    if (centreId === null) return EMPTY_NOTES_SNAPSHOT;
    return { centreId, notes: this.centres.get(centreId) ?? [] };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Registers work to undo when the service is disposed. */
  onDispose(teardown: () => void): void {
    this.teardowns.push(teardown);
  }

  dispose(): void {
    for (const t of this.teardowns) t();
    this.teardowns = [];
    this.listeners.clear();
  }

  addNote(centreId: string, input: { body: string; createdBy?: string }): Note {
    const now = this.nowFn();
    const list = this.centres.get(centreId) ?? [];
    const note: Note = {
      id: safeRandomUuid(),
      body: input.body,
      order: nextOrder(list),
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    };
    this.centres.set(centreId, [...list, note]);
    this.persistAndEmit(centreId);
    return note;
  }

  updateNote(
    centreId: string,
    id: string,
    body: string,
    baseVersion: number,
  ): NoteResult {
    const list = this.centres.get(centreId) ?? [];
    const idx = list.findIndex((n) => n.id === id);
    if (idx < 0) return { ok: false, current: null };
    const current = list[idx];
    if (current.version !== baseVersion) return { ok: false, current };
    if (current.body === body) return { ok: true };
    const next = [...list];
    next[idx] = {
      ...current,
      body,
      version: current.version + 1,
      updatedAt: this.nowFn(),
    };
    this.centres.set(centreId, next);
    this.persistAndEmit(centreId);
    return { ok: true };
  }

  deleteNote(centreId: string, id: string, baseVersion: number): NoteResult {
    const list = this.centres.get(centreId) ?? [];
    const current = list.find((n) => n.id === id);
    if (!current) return { ok: false, current: null };
    if (current.version !== baseVersion) return { ok: false, current };
    this.centres.set(
      centreId,
      list.filter((n) => n.id !== id),
    );
    this.persistAndEmit(centreId);
    return { ok: true };
  }

  /**
   * Reorder `id` to land directly after `afterId` (or first when null).
   * Recomputes orders densely so two reorders never collide on equal
   * `order` values. Only the moved note's version advances.
   */
  reorderNote(
    centreId: string,
    id: string,
    afterId: string | null,
    baseVersion: number,
  ): NoteResult {
    const list = this.centres.get(centreId) ?? [];
    const found = list.find((n) => n.id === id);
    if (!found) return { ok: false, current: null };
    if (found.version !== baseVersion) return { ok: false, current: found };
    if (afterId === id) return { ok: true };
    const subject: Note = {
      ...found,
      version: found.version + 1,
      updatedAt: this.nowFn(),
    };
    const remaining = list
      .filter((n) => n.id !== id)
      .sort((a, b) => a.order - b.order);
    let inserted = false;
    const next: Note[] = [];
    if (afterId === null) {
      next.push(subject);
      inserted = true;
    }
    for (const note of remaining) {
      next.push(note);
      if (!inserted && note.id === afterId) {
        next.push(subject);
        inserted = true;
      }
    }
    if (!inserted) next.push(subject);
    this.centres.set(
      centreId,
      next.map((n, i) => ({ ...n, order: i })),
    );
    this.persistAndEmit(centreId);
    return { ok: true };
  }

  private persistAndEmit(centreId: string): void {
    this.persistToStorage();
    const snap = this.snapshot(centreId);
    for (const l of this.listeners) l(snap);
  }

  private persistToStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.centres)),
      );
    } catch (err) {
      logger.warn("[notes] persist failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private loadFromStorage(): Record<string, Note[]> | null {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const out: Record<string, Note[]> = {};
      for (const [centreId, rows] of Object.entries(parsed)) {
        if (Array.isArray(rows)) out[centreId] = validNotes(rows);
      }
      return out;
    } catch (err) {
      logger.warn("[notes] load failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

function nextOrder(list: readonly Note[]): number {
  if (list.length === 0) return 0;
  return Math.max(...list.map((n) => n.order)) + 1;
}

/** Rows that carry the fields a note needs; a missing version counts as the first. */
function validNotes(rows: readonly unknown[]): Note[] {
  const out: Note[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const n = row as Partial<Note>;
    if (
      typeof n.id !== "string" ||
      typeof n.body !== "string" ||
      typeof n.order !== "number"
    )
      continue;
    out.push({
      id: n.id,
      body: n.body,
      order: n.order,
      version: typeof n.version === "number" ? n.version : 1,
      createdAt: typeof n.createdAt === "number" ? n.createdAt : 0,
      updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : 0,
      createdBy: n.createdBy,
    });
  }
  return out;
}

export { EMPTY_NOTES_SNAPSHOT };
