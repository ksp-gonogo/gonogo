/**
 * Value-equality for widget config objects, used to decide whether a config
 * modal's working draft differs from the persisted config (the "dirty" flag
 * that gates the discard-changes guard).
 *
 * Semantics tuned for config shapes:
 * - `undefined` and a missing key are treated the same (config defaults are
 *   often `key: undefined` vs the key simply absent).
 * - Object key order is irrelevant.
 * - Arrays compare by index.
 *
 * Not a general-purpose deep-equal: it doesn't handle Map/Set/Date/etc. Config
 * values are plain JSON-ish data, so that's fine.
 */
export function configEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => configEqual(item, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    // Union of keys whose value is not undefined on either side.
    const keys = new Set<string>();
    for (const k of Object.keys(ao)) if (ao[k] !== undefined) keys.add(k);
    for (const k of Object.keys(bo)) if (bo[k] !== undefined) keys.add(k);
    for (const k of keys) {
      if (!configEqual(ao[k], bo[k])) return false;
    }
    return true;
  }

  return false;
}
