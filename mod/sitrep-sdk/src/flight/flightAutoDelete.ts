import { LocalStorageStore } from "./storage/LocalStorageStore";

/**
 * Default cap when the user enables auto-delete. The setting persists as a
 * number rather than a boolean so we can broaden the UI later (10 / 20 / 50)
 * without a migration. Starred flights and the current flight don't count
 * toward this cap and are never evicted.
 *
 * @category Flight recording
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

/**
 * How many unstarred flights auto-delete keeps; 0 when auto-delete is off.
 *
 * @category Flight recording
 */
export function getKeepCount(): number {
  const { keepCount } = store.get();
  return Number.isFinite(keepCount) && keepCount > 0
    ? Math.floor(keepCount)
    : 0;
}

/**
 * Sets how many unstarred flights auto-delete keeps. 0, a negative number or a
 * non-number turns it off.
 *
 * @category Flight recording
 */
export function setKeepCount(keepCount: number): void {
  const safe =
    Number.isFinite(keepCount) && keepCount > 0 ? Math.floor(keepCount) : 0;
  store.set({ keepCount: safe });
}

/**
 * Calls `cb` whenever the auto-delete setting changes, and returns the
 * unsubscribe function.
 *
 * @category Flight recording
 */
export function subscribeAutoDelete(cb: (prefs: Prefs) => void): () => void {
  return store.subscribe(cb);
}
