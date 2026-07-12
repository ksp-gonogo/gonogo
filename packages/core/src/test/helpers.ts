/**
 * Shared test helpers for @ksp-gonogo/core consumers.
 *
 * Keep this file dependency-free beyond the core package itself — it must not
 * import from @ksp-gonogo/data, @ksp-gonogo/components, or any other downstream
 * package, or it would create a circular workspace dependency.
 */

/**
 * In-memory `Storage` shim for tests that need a localStorage-shaped object
 * without leaking state between cases.
 *
 * Faithfully reproduces the duplicate `memoryStorage()` shims that previously
 * lived in `app/src/alarms/AlarmHostService.test.ts` and
 * `serial/src/SerialDeviceService.test.ts`. Both copies were identical, so
 * this is a drop-in replacement.
 *
 * Note: `length` is fixed at 0 and `key()` always returns null — matching the
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
