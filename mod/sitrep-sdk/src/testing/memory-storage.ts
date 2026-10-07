/**
 * A `Storage` held in memory, for a test that needs a `localStorage` of its own.
 * It reads, writes, removes and clears by key, and that is all: it cannot be
 * walked. `length` is always 0 and `key()` always returns `null` whatever it
 * holds, so do not use it for code that lists what storage contains.
 *
 * @category Test doubles
 */
export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => {
      map.clear();
    },
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}
