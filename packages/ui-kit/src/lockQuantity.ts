import { writeQuantity } from "./units";

/** A quantity in a lock sentence, written the way the kit writes every other one. */
export function writeLockQuantity(
  quantity: { magnitude: number; unit: string } | number,
  unit: string,
): string {
  return writeQuantity(
    typeof quantity === "number" ? { magnitude: quantity, unit } : quantity,
  );
}
