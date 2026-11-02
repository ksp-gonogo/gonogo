import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";

/**
 * The scale bar's length: the longest of 1, 2 and 5 times a power of ten that
 * fits the room, and the words for it.
 */

/** The longest round length, in metres, whose bar fits in `maxPx` at `pxPerMetre`; null where none does. */
export function niceLength(pxPerMetre: number, maxPx: number): number | null {
  if (!(pxPerMetre > 0) || !(maxPx > 0)) return null;
  let best: number | null = null;
  for (let e = -3; e <= 12; e++) {
    for (const m of [1, 2, 5]) {
      const length = m * 10 ** e;
      if (length * pxPerMetre <= maxPx) best = length;
    }
  }
  return best;
}

/** A length in the words the readouts use: metres, then kilometres from a thousand however large. */
export function lengthLabel(metres: number): string {
  const shown = metres >= 1_000 ? metres / 1_000 : metres;
  return writeQuantity(value("m", metres), {
    // The ladder would climb to megametres.
    format: metres >= 1_000 ? "km" : "m",
    decimals: Number.isInteger(shown) ? 0 : metres < 1 ? 2 : 1,
  });
}
