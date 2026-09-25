import { isValue, type Value } from "../unit-system/value";

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate === null || typeof candidate !== "object") return false;
  const proto = Object.getPrototypeOf(candidate);
  return proto === Object.prototype || proto === null;
}

/** A `Value` carrying nothing beyond its magnitude and unit, so those two decide equality. */
function isBareValue(candidate: unknown): candidate is Value {
  return (
    isValue(candidate) &&
    !isRecord(candidate) &&
    Object.keys(candidate).length === 2
  );
}

/**
 * `next`, with every part of it that is structurally equal to the same part of
 * `previous` replaced by `previous`'s own object. Returns `previous` itself
 * when the two are equal throughout, so a caller comparing by reference sees
 * "unchanged" exactly when nothing is.
 *
 * Walks plain records, arrays and `Value`s. Anything else (a `Map`, a class
 * instance) is equal only to itself.
 */
export function shareEqual(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;

  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length;
    const shared = next.map((item, i) => {
      const kept = shareEqual(previous[i], item);
      if (!Object.is(kept, previous[i])) same = false;
      return kept;
    });
    return same ? previous : shared;
  }

  if (isBareValue(previous) && isBareValue(next)) {
    return Object.getPrototypeOf(previous) === Object.getPrototypeOf(next) &&
      previous.unit === next.unit &&
      previous.equals(next)
      ? previous
      : next;
  }

  if (isRecord(previous) && isRecord(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    const shared: Record<string, unknown> =
      Object.getPrototypeOf(next) === null ? Object.create(null) : {};
    for (const key of keys) {
      const kept = shareEqual(previous[key], next[key]);
      if (!(key in previous) || !Object.is(kept, previous[key])) same = false;
      shared[key] = kept;
    }
    return same ? previous : shared;
  }

  return next;
}
