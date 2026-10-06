/**
 * A `Storage` held in memory, for a test that needs a `localStorage` of its own.
 * `length` is always 0 and `key()` always returns `null`.
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
