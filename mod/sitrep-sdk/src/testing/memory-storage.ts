/**
 * A `Storage` held in memory, for a test that needs a `localStorage` of its own.
 * It behaves as the browser's does: `length` and `key()` reflect what it holds,
 * in the order the keys were first set.
 *
 * @example Giving a `SettingsService` storage of its own
 * ```ts
 * import { SettingsService } from "@ksp-gonogo/sitrep-sdk";
 * import { memoryStorage } from "@ksp-gonogo/sitrep-sdk/testing";
 *
 * const settings = new SettingsService(memoryStorage());
 * settings.set("units", "metric");
 * ```
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
