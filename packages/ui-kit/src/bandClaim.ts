import type { BandKind } from "@ksp-gonogo/sitrep-sdk";

/**
 * What a band CLAIMS, in plain language, for the one surface that has to speak
 * it rather than draw it.
 *
 * A hard bound and a one-sigma interval read the same sentence: both are said
 * as plain containment, with no qualifier distinguishing one from the other.
 * `kind` stays on the signature so every call site keeps the same shape, even
 * though the two arms currently agree.
 *
 * `claimed` is the containment statement the calling surface would make on its
 * own, in whatever grammar that surface needs: an interval for a meter that
 * has both ends to hand (`"with bands at 30 percent and 44 percent"`), a whole
 * clause for a chart whose shaded region has different ends at every sample.
 * So no surface has to know the rule and no two surfaces can disagree about
 * it.
 *
 * **No statistics vocabulary.** "One sigma", "standard deviation" and
 * "confidence interval" are names for the thing, not statements about the
 * value: someone who knows the statistics learns nothing from them that the
 * numbers did not already say, and someone who does not learns nothing at
 * all.
 */
export function bandClaim(_kind: BandKind, claimed: string): string {
  return claimed;
}
