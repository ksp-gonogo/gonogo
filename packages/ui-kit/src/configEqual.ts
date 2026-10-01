/**
 * Value equality for widget config objects, as {@link useModalSaveBar} uses
 * it to decide whether a draft differs from the saved config.
 *
 * - `undefined` and a missing key are treated the same
 * - object key order is ignored
 * - arrays compare by index
 *
 * - `Date` values compare by time, `Set` by membership (primitives and
 *   deep-equal members) and `Map` by entries
 *
 * @category Modal
 */
export function configEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => configEqual(item, b[i]));
  }

  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date &&
      b instanceof Date &&
      Object.is(a.getTime(), b.getTime())
    );
  }

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return false;
    if (a.size !== b.size) return false;
    const rest = [...b];
    // Greedy match is exact here: configEqual is an equivalence relation.
    return [...a].every((x) => {
      const i = rest.findIndex((y) => configEqual(x, y));
      if (i === -1) return false;
      rest.splice(i, 1);
      return true;
    });
  }

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return false;
    if (a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !configEqual(v, b.get(k))) return false;
    }
    return true;
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
