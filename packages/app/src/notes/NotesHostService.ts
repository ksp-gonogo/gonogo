import { safeRandomUuid } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { EMPTY_NOTES_SNAPSHOT, type Note, type NotesSnapshot } from "./types";

const STORAGE_KEY = "gonogo.notes.v1";

type Listener = (snap: NotesSnapshot) => void;

/**
 * Main-screen owner of the mission notes list. Holds the canonical state,
 * persists to localStorage so notes survive a refresh, and emits to
 * subscribers whenever the list changes. The peer bridge fans the snapshot
 * out to stations and routes mutations back through the public mutator API.
 */
export class NotesHostService {
  private notes: Note[] = [];
  private listeners = new Set<Listener>();
  private nowFn: () => number;

  constructor(opts: { now?: () => number; load?: () => Note[] | null } = {}) {
    this.nowFn = opts.now ?? (() => Date.now());
    const loaded = opts.load ? opts.load() : this.loadFromStorage();
    if (loaded) this.notes = [...loaded];
  }

  // ─────────────────── Public read API ───────────────────

  snapshot(): NotesSnapshot {
    return { notes: this.notes };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ─────────────────── Public mutators ───────────────────

  addNote(input: { body: string; createdBy?: string }): Note {
    const now = this.nowFn();
    const note: Note = {
      id: safeRandomUuid(),
      body: input.body,
      order: this.nextOrder(),
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    };
    this.notes = [...this.notes, note];
    this.persistAndEmit();
    return note;
  }

  updateNote(id: string, body: string): void {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx < 0) return;
    if (this.notes[idx].body === body) return;
    const next = [...this.notes];
    next[idx] = { ...next[idx], body, updatedAt: this.nowFn() };
    this.notes = next;
    this.persistAndEmit();
  }

  deleteNote(id: string): void {
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.notes.length === before) return;
    this.persistAndEmit();
  }

  /**
   * Reorder `id` to land directly after `afterId` (or first when null).
   * Recomputes orders densely so two reorders never collide on equal
   * `order` values.
   */
  reorderNote(id: string, afterId: string | null): void {
    const subject = this.notes.find((n) => n.id === id);
    if (!subject) return;
    if (afterId === id) return;
    const remaining = this.notes
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
    this.notes = next.map((n, i) => ({ ...n, order: i }));
    this.persistAndEmit();
  }

  /**
   * Replace every note's body wholesale. Test-only convenience for
   * round-tripping snapshots from storage; not exposed to the peer
   * protocol.
   */
  replaceForTesting(notes: readonly Note[]): void {
    this.notes = [...notes];
    this.persistAndEmit();
  }

  // ─────────────────── Internals ───────────────────

  private nextOrder(): number {
    if (this.notes.length === 0) return 0;
    return Math.max(...this.notes.map((n) => n.order)) + 1;
  }

  private persistAndEmit(): void {
    this.persistToStorage();
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  private persistToStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.notes));
    } catch (err) {
      logger.warn("[notes] persist failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private loadFromStorage(): Note[] | null {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Note[];
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(
        (n) =>
          n &&
          typeof n.id === "string" &&
          typeof n.body === "string" &&
          typeof n.order === "number",
      );
    } catch (err) {
      logger.warn("[notes] load failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

export { EMPTY_NOTES_SNAPSHOT };
