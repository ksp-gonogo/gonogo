/**
 * A generic, off-tree external store: an id-keyed set of entries with
 * `subscribe`/`getSnapshot`/`register`/`update`, a referentially stable
 * snapshot while unchanged, and insertion order. No React, no panel, no DOM
 * knowledge; the per-panel context plumbing is `createPanelStore`'s job, and a
 * derived view (the status summary) is layered on top by its own store.
 *
 * This is the shared spine under `PanelStatusStore` and the delay rail store:
 * both were the same "Map of contributions + listener set + dirty-flagged
 * cached snapshot" written twice, so the machinery lives here once.
 *
 * HARD RULE carried from those designs: the live data lives in the store, never
 * in a React context value, so a change re-renders only the snapshot's
 * subscribers, not every widget in the tree.
 */
export interface Store<T extends { id: string }> {
  /** Add or replace an entry (keyed on `entry.id`). Returns its deregister function. */
  register(entry: T): () => void;
  /**
   * Change an already-registered entry's non-id fields in place. A no-op when
   * the id is unknown, and a no-op (no notify, snapshot identity preserved)
   * when every field is shallow-equal to the current entry, so a value that
   * did not actually move does not hand `useSyncExternalStore` a fresh
   * snapshot.
   */
  update(id: string, next: Omit<T, "id">): void;
  /** Subscribe to any change to the entry set. Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** The entries, insertion-ordered, referentially stable while unchanged. */
  getSnapshot(): readonly T[];
}

// Shared frozen empty snapshot so an empty store returns one stable identity
// (a fresh `[]` per call would loop `useSyncExternalStore`).
const EMPTY: readonly never[] = Object.freeze([]);

/** Shallow-equal over `next`'s own keys against the current entry (id aside). */
function unchanged<T extends { id: string }>(
  current: T,
  next: Omit<T, "id">,
): boolean {
  for (const key in next) {
    if (
      (current as Record<string, unknown>)[key] !==
      (next as Record<string, unknown>)[key]
    ) {
      return false;
    }
  }
  return true;
}

export function createStore<T extends { id: string }>(): Store<T> {
  // Insertion-ordered by construction (Map), so the snapshot order is stable
  // and a top-rank tie-break (in a derived view) is deterministic.
  const entries = new Map<string, T>();
  const listeners = new Set<() => void>();

  // Dirty-flagged cache so `getSnapshot` returns a stable array while the set
  // is unchanged and rebuilds only after a real change.
  let cached: readonly T[] = EMPTY;
  let dirty = true;

  function emit() {
    dirty = true;
    for (const listener of listeners) listener();
  }

  return {
    register(entry) {
      entries.set(entry.id, entry);
      emit();
      return () => {
        if (entries.delete(entry.id)) emit();
      };
    },
    update(id, next) {
      const current = entries.get(id);
      if (!current || unchanged(current, next)) return;
      entries.set(id, { id, ...next } as T);
      emit();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    getSnapshot() {
      if (dirty) {
        cached = entries.size === 0 ? EMPTY : Array.from(entries.values());
        dirty = false;
      }
      return cached;
    },
  };
}
