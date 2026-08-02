/**
 * KSP-time unit sizes, in seconds.
 *
 * **A KSP day is 6 hours, not 24, and a KSP year is 426 days, not 365.** Stock
 * KSP runs on Kerbin time, where Kerbin's rotation period is 6h and its orbital
 * period is 426 of those days. Every duration on the wire arrives in SI
 * seconds, so any widget that wants to say "days" has to divide by something,
 * and dividing by 86,400 quietly renders a Kerbin figure on an Earth calendar:
 * a life-support readout that should say "18h to depletion" says "0d 18h" and
 * one that should say "3d" says "18h", four times too small either way.
 *
 * These constants exist so that number is written down once. Import them rather
 * than restating `21_600`, and prefer `formatDuration` over doing the division
 * at all when the output is a duration a human reads.
 */

/** One Kerbin rotation. 6 hours. */
export const KSP_DAY_SECONDS = 21_600;

/** Days in one Kerbin orbit of the sun. */
export const KSP_YEAR_DAYS = 426;

/** One Kerbin orbit of the sun, in seconds. */
export const KSP_YEAR_SECONDS = KSP_YEAR_DAYS * KSP_DAY_SECONDS;
