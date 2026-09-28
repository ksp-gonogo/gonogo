/**
 * A generic, off-tree external store: an id-keyed set of entries with
 * `subscribe`/`getSnapshot`/`register`/`update`, a referentially stable
 * snapshot while unchanged, and insertion order.
 *
 * The live data lives in the store, never in a React context value, so a
 * change re-renders only the snapshot's subscribers.
 */
export interface Store<Item extends { id: string }> {
  /** Add or replace an entry (keyed on `entry.id`). Returns its deregister function. */
  register(entry: Item): () => void;
  /**
   * Change an already-registered entry's non-id fields in place. A no-op when
   * the id is unknown, and a no-op (no notify, snapshot identity preserved)
   * when every field is shallow-equal to the current entry, so a value that
   * did not actually move does not hand `useSyncExternalStore` a fresh
   * snapshot.
   */
  update(id: string, next: Omit<Item, "id">): void;
  /** Subscribe to any change to the entry set. Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** The entries, insertion-ordered, referentially stable while unchanged. */
  getSnapshot(): readonly Item[];
}

// Shared frozen empty snapshot so an empty store returns one stable identity (a fresh `[]` per call would loop `useSyncExternalStore`).
const EMPTY: readonly never[] = Object.freeze([]);

/** Shallow-equal over `next`'s own keys against the current entry (id aside). */
function unchanged<Item extends { id: string }>(
  current: Item,
  next: Omit<Item, "id">,
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

export function createStore<Item extends { id: string }>(): Store<Item> {
  // Insertion order keeps a derived view's top-rank tie-break deterministic.
  const entries = new Map<string, Item>();
  const listeners = new Set<() => void>();

  let cached: readonly Item[] = EMPTY;
  let dirty = true;

  function emit() {
    dirty = true;
    for (const listener of listeners) listener();
  }

  // Which registration currently owns each id, so a registrant that has been replaced cannot deregister its replacement.
  const owners = new Map<string, object>();

  return {
    register(entry) {
      const owner = {};
      entries.set(entry.id, entry);
      owners.set(entry.id, owner);
      emit();
      return () => {
        if (owners.get(entry.id) !== owner) return;
        owners.delete(entry.id);
        if (entries.delete(entry.id)) emit();
      };
    },
    update(id, next) {
      const current = entries.get(id);
      if (!current || unchanged(current, next)) return;
      entries.set(id, { id, ...next } as Item);
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
