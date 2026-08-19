import { LocalStorageStore } from "./storage/LocalStorageStore";

/**
 * Default cap when the user enables auto-delete. The setting persists as a
 * number rather than a boolean so we can broaden the UI later (10 / 20 / 50)
 * without a migration. Starred flights and the current flight don't count
 * toward this cap and are never evicted.
 */
export const DEFAULT_KEEP_COUNT = 20;

interface Prefs {
  /** 0 = disabled. Otherwise the max number of unstarred flights to retain. */
  keepCount: number;
}

const store = new LocalStorageStore<Prefs>({
  key: "gonogo.flights.autoDelete",
  defaults: { keepCount: 0 },
});

export function getKeepCount(): number {
  const { keepCount } = store.get();
  return Number.isFinite(keepCount) && keepCount > 0
    ? Math.floor(keepCount)
    : 0;
}

export function setKeepCount(keepCount: number): void {
  const safe =
    Number.isFinite(keepCount) && keepCount > 0 ? Math.floor(keepCount) : 0;
  store.set({ keepCount: safe });
}

export function subscribeAutoDelete(cb: (prefs: Prefs) => void): () => void {
  return store.subscribe(cb);
}
