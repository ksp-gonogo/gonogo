/**
 * In-memory `Storage` shim for tests that need a localStorage-shaped object
 * without leaking state between cases.
 *
 * Moved down from `core` on 2026-08-19: it imports nothing, so nothing kept it
 * in an unpublished package that an Uplink's own tests had to reach into.
 *
 * Note: `length` is fixed at 0 and `key()` always returns null, matching the
 * existing shims. Tests that rely on `Storage.length` or `Storage.key(i)`
 * will need a more complete fake.
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
