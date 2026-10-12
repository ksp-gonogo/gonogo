import { writeQuantity } from "./units";

/**
 * A quantity in a lock sentence (a science cost, a building level), written the
 * way the kit writes every other quantity. Useful for the lock text the
 * operator reads about what is still to be unlocked. Used by {@link LockMark}
 * and {@link LockScope}.
 */
export function writeLockQuantity(
  quantity: { magnitude: number; unit: string } | number,
  unit: string,
): string {
  return writeQuantity(
    typeof quantity === "number" ? { magnitude: quantity, unit } : quantity,
  );
}
