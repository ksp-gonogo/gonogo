import type { BandKind } from "@ksp-gonogo/sitrep-sdk";

/**
 * What a band claims, in plain language, for a surface that speaks it rather
 * than draws it. A hard bound and a one-sigma interval are both said as plain
 * containment, with no statistics vocabulary, so `claimed` is returned
 * unchanged for every `kind`.
 *
 * `claimed` is the containment statement in the calling surface's own grammar:
 * an interval for a meter (`"with bands at 30 percent and 44 percent"`), a
 * whole clause for a chart whose shaded region varies per sample.
 *
 * @category Unit
 */
export function bandClaim(_kind: BandKind, claimed: string): string {
  return claimed;
}
