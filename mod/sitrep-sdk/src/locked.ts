import type { LockedValue } from "./__generated__/contract";

/**
 * Whether a field a requirement gates arrived as the `LockedValue` naming
 * what this save is missing, rather than its value. A field drawn to an
 * operator branches on this, so the lock is shown instead of read as nothing.
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
 * A gated field's value, or `null` while it is locked. For logic that has
 * nothing to work with either way, such as a model that stops at an
 * encounter; a field an operator reads uses {@link isLocked} instead.
 *
 * @category Readings
 */
export function unlessLocked<Value>(value: Value | LockedValue): Value | null {
  return isLocked(value) ? null : value;
}
