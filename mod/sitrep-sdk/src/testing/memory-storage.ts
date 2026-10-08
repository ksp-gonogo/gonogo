/**
 * A `Storage` held in memory, for a test that needs a `localStorage` of its own.
 * It behaves as the browser's does: `length` and `key()` reflect what it holds,
 * in the order the keys were first set.
 *
 * @category Test doubles
 */
export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}
