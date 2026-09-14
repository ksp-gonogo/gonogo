import type { BandKind } from "@ksp-gonogo/sitrep-sdk";

/**
 * How often a one-sigma interval actually holds, in words a listener already
 * has.
 *
 * One standard deviation covers a little over 68% of the distribution, so the
 * value is inside about two thirds of the time. Saying the frequency is what
 * makes the hedge a number rather than an adverb: "roughly" and "probably"
 * both sound like hedging without ever saying how much, and an operator cannot
 * act on either.
 */
const HOLD_RATE = "about two thirds of the time";

/**
 * What a band CLAIMS, in plain language, for the one surface that has to speak
 * it rather than draw it.
 *
 * A hard bound and a one-sigma interval are the same two numbers until
 * something says which, and they are worth very different amounts: crossing a
 * hard bound is impossible, crossing one sigma happens about a third of the
 * time. A reader who has the shading, the hairline edge or the tick marks can
 * see the difference. A reader who is being read to has nothing but this
 * sentence.
 *
 * `claimed` is the containment statement the calling surface would make on its
 * own, in whatever grammar that surface needs: an interval for a meter that
 * has both ends to hand (`"30 percent to 44 percent"`), a whole clause for a
 * chart whose shaded region has different ends at every sample. This qualifies
 * it and nothing more, so no surface has to know the rule and no two surfaces
 * can disagree about it.
 *
 * **A hard bound comes back untouched, and that is the answer rather than a
 * missing case.** Containment is the claim in full; qualifying it would weaken
 * a statement the model was entitled to make. The difference a listener hears
 * is the qualifier's presence, which is why the two arms must never both carry
 * one.
 *
 * **No statistics vocabulary, in either arm.** "One sigma", "standard
 * deviation" and "confidence interval" are names for the thing, not statements
 * about the value: someone who knows the statistics learns nothing from them
 * that the numbers did not already say, and someone who does not learns
 * nothing at all. Both were in use on three different surfaces here before this
 * helper existed, in three different wordings.
 */
export function bandClaim(kind: BandKind, claimed: string): string {
  return kind === "sigma1" ? `${claimed} ${HOLD_RATE}` : claimed;
}
