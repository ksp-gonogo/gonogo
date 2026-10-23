/**
 * The countdown prints whole seconds, so an apsis instant that moves by more than this between samples is not one the display can state.
 */
export const APSIS_RESOLUTION_SECONDS = 1;

/** Distinct samples needed before the instant's spread says anything. */
export const APSIS_MIN_SAMPLES = 3;

const WINDOW = 6;

/** The least a new apsis instant must differ from the last for it to be a new sample and not the same one read on another frame. */
const SAME_SAMPLE_SECONDS = 1e-3;

/**
 * How widely the instants of the same apsis, one per sample, are scattered, in
 * seconds. An apsis is reached once per period, so each instant is reduced to
 * its offset from the first modulo the period before the range is taken.
 */
export function apsisInstantSpread(
  instants: readonly number[],
  period: number,
): number {
  if (instants.length < 2 || !(period > 0)) return 0;
  const first = instants[0];
  let low = 0;
  let high = 0;
  for (const instant of instants) {
    let offset = (instant - first) % period;
    if (offset > period / 2) offset -= period;
    if (offset < -period / 2) offset += period;
    low = Math.min(low, offset);
    high = Math.max(high, offset);
  }
  return high - low;
}

/** Adds the apsis instant a sample implies to the recent window, once per sample, newest last. */
export function recordApsisInstant(window: number[], instant: number): void {
  if (!Number.isFinite(instant)) return;
  const last = window.at(-1);
  if (last !== undefined && Math.abs(instant - last) < SAME_SAMPLE_SECONDS) {
    return;
  }
  window.push(instant);
  if (window.length > WINDOW) window.shift();
}

/**
 * The eccentricity from which the two apsides are distinct places. They sit
 * `2·e·a` apart, which at 0.01 is two percent of the semi-major axis and far
 * above positional noise, so no scatter in a countdown can move the apsis.
 */
export const APSIS_MIN_ECCENTRICITY = 0.01;

/**
 * Whether the orbit's apsis is a place the display can name: false when the
 * orbit is nearly circular and successive samples put the apsis at instants
 * spread wider than the countdown resolves, which is what an eccentricity too
 * small for the sample to fix the apsis direction looks like. An orbit eccentric
 * enough to have an apsis is defined whatever the samples scatter by. Undefined
 * until enough samples are in.
 */
export function apsisIsDefined(
  window: readonly number[],
  period: number | undefined,
  eccentricity?: number,
): boolean | undefined {
  if (eccentricity !== undefined && eccentricity >= APSIS_MIN_ECCENTRICITY) {
    return true;
  }
  if (window.length < APSIS_MIN_SAMPLES || period === undefined) {
    return undefined;
  }
  return apsisInstantSpread(window, period) <= APSIS_RESOLUTION_SECONDS;
}
