/**
 * In-memory `Storage` shim for tests that need a localStorage-shaped object
 * without leaking state between cases.
 *
 * Note: `length` is fixed at 0 and `key()` always returns null, matching the
 * existing shims. Tests that rely on `Storage.length` or `Storage.key(i)`
 * will need a more complete fake.
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
