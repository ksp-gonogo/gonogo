import type { LockedValue } from "./__generated__/contract";

/**
 * Returns whether a field arrived as a {@link LockedValue} instead of its
 * value: the save has not yet unlocked what the field needs, a tech node or a
 * building level. A widget that shows the field checks this first, so it
 * can show what is missing rather than an empty value.
 *
 * @category Readings
 */
export function isLocked(value: unknown): value is LockedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { locked?: unknown }).locked)
  );
}

/**
 * Returns a field's value, or `null` while it is a {@link LockedValue}. Use it
 * in calculations, where a locked field and a missing one both mean there is
 * nothing to work with. To show the field, use {@link isLocked} instead, so
 * the operator sees why it is empty.
 *
 * @category Readings
 */
export function unlessLocked<Value>(value: Value | LockedValue): Value | null {
  return isLocked(value) ? null : value;
}
