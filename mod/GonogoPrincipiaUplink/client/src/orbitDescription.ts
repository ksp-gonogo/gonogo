import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import type { PrincipiaOrbitAnalysis } from "./__generated__/contract";

/**
 * The producer's own adjective phrase for an orbit: "circular Kerbin orbit",
 * "retrograde polar Duna orbit".
 *
 * <p>Assembled here rather than on the wire because it is a sentence, and a
 * sentence is presentation. Every threshold below is the producer's own, so the
 * phrase on this board and the title of its window agree word for word, which is
 * the whole reason this Uplink reads the producer's analysis instead of deriving
 * one.</p>
 *
 * <p><b>Read from the band ENDS, never a midpoint.</b> Circular is
 * "eccentricity never exceeds 0.01 over the window", not "averages under it". An
 * orbit whose eccentricity swings from 0 to 0.4 is not circular, and a midpoint
 * test calls it nearly so.</p>
 *
 * <p><b>Synchronous, stationary and semi-synchronous are reachable and are
 * said.</b> They used to be listed as impossible, on the belief that they needed
 * a recurrence hypothesis this Uplink refused to supply. They do not: the
 * producer fits a recurrence itself and derives the equatorial crossings from
 * it, and the crossings' drift is what decides all three.</p>
 *
 * <p>Sun-synchronous is still missing, for an unrelated reason recorded on
 * {@link UNREACHABLE_ADJECTIVES}. The widget names what it cannot reach rather
 * than letting an operator infer that a sun-synchronous orbit is not one.</p>
 */
export function orbitDescription(
  analysis: PrincipiaOrbitAnalysis | undefined,
): string | null {
  if (analysis == null || analysis.elementsPresent !== true) {
    return null;
  }
  if (analysis.gravitationallyBound === false) {
    // Not an orbit at all, so no orbit phrase. The producer says the same thing
    // in its own warning rather than describing a shape.
    return null;
  }

  const eccentricityMin = magnitudeOf(analysis.meanEccentricity?.min);
  const eccentricityMax = magnitudeOf(analysis.meanEccentricity?.max);
  const inclinationMin = magnitudeOf(analysis.meanInclinationDegrees?.min);
  const inclinationMax = magnitudeOf(analysis.meanInclinationDegrees?.max);

  const adjectives: string[] = [];
  if (eccentricityMax !== null && eccentricityMax < CIRCULAR_ECCENTRICITY) {
    adjectives.push("circular");
  }
  if (
    eccentricityMin !== null &&
    eccentricityMin > HIGHLY_ELLIPTICAL_ECCENTRICITY
  ) {
    adjectives.push("highly elliptical");
  }
  if (
    inclinationMin !== null &&
    inclinationMax !== null &&
    (inclinationMax < EQUATORIAL_DEGREES ||
      inclinationMin > 180 - EQUATORIAL_DEGREES)
  ) {
    // One adjective covers both the prograde and the retrograde equator: an
    // orbit at 178° is equatorial AND retrograde, and the producer prints both.
    adjectives.push("equatorial");
  }
  if (
    inclinationMin !== null &&
    inclinationMax !== null &&
    inclinationMin > 90 - POLAR_TOLERANCE_DEGREES &&
    inclinationMax < 90 + POLAR_TOLERANCE_DEGREES
  ) {
    adjectives.push("polar");
  }
  if (inclinationMin !== null && inclinationMin > 90) {
    adjectives.push("retrograde");
  }

  const synchronicity = synchronicityOf(analysis, {
    circular: adjectives.includes("circular"),
    equatorial: adjectives.includes("equatorial"),
  });
  if (synchronicity !== null) {
    /*
     * Stationary REPLACES the rest rather than joining them: the producer's own
     * phrase for it is "stationary over Kerbin", and "circular equatorial
     * stationary Kerbin orbit" says the same thing three times.
     */
    if (synchronicity === "stationary") {
      adjectives.length = 0;
    }
    adjectives.push(synchronicity);
  }

  const body = analysis.primaryBody;
  const words = [...adjectives, body, "orbit"].filter(
    (word): word is string => typeof word === "string" && word.length > 0,
  );
  // "orbit" alone says nothing an operator did not already know, so a phrase
  // with neither an adjective nor a body is no phrase.
  return words.length > 1 ? words.join(" ") : null;
}

/** The producer's own thresholds, in the units the wire carries. */
const CIRCULAR_ECCENTRICITY = 0.01;
const HIGHLY_ELLIPTICAL_ECCENTRICITY = 0.5;
const EQUATORIAL_DEGREES = 5;
const POLAR_TOLERANCE_DEGREES = 10;

/**
 * The producer's own synchronicity threshold: a track drifting less than this
 * per turn of the primary is treated as repeating.
 */
const SYNCHRONOUS_DRIFT_DEGREES_PER_ROTATION = 0.1;

/**
 * Whether the ground track repeats closely enough to name the orbit after it,
 * following the producer's own rule exactly.
 *
 * <p>The test is the DRIFT of the equatorial crossing bands, not the recurrence
 * alone. A recurrence can be fitted to almost any closed orbit; what makes one
 * synchronous is that successive passes cross the equator at the same longitude,
 * which is what a band that barely widens means.</p>
 *
 * <p><b>Zero drift is refused, not accepted.</b> It means the analysis caught a
 * single pass, and one pass cannot establish that anything repeats. Reading it
 * as perfect synchronicity would call every briefly-analysed orbit stationary,
 * which is the most confident possible way to be wrong.</p>
 */
function synchronicityOf(
  analysis: PrincipiaOrbitAnalysis,
  shape: { circular: boolean; equatorial: boolean },
): "stationary" | "synchronous" | "semi-synchronous" | null {
  const cycleRotations = magnitudeOf(analysis.recurrenceCycleRotations);
  const revolutionsPerRotation = magnitudeOf(
    analysis.recurrenceRevolutionsPerRotation,
  );
  const revolutions = magnitudeOf(analysis.recurrenceRevolutions);
  const ascending = analysis.ascendingCrossingDegrees;
  const descending = analysis.descendingCrossingDegrees;
  const missionDuration = magnitudeOf(analysis.missionDurationSeconds);
  const nodalPeriod = magnitudeOf(analysis.nodalPeriodSeconds);

  if (
    cycleRotations === null ||
    revolutionsPerRotation === null ||
    revolutions === null ||
    missionDuration === null ||
    nodalPeriod === null ||
    nodalPeriod <= 0
  ) {
    return null;
  }

  const spans = [
    span(ascending?.min, ascending?.max),
    span(descending?.min, descending?.max),
  ].filter((value): value is number => value !== null);
  if (spans.length === 0) return null;
  const drift = Math.max(...spans);
  if (drift <= 0) return null;

  // Revolutions the analysis actually covered, against turns of the primary the
  // recurrence says those revolutions take.
  const revolutionsPerCycle = revolutions / cycleRotations;
  if (revolutionsPerCycle <= 0) return null;
  const rotations = missionDuration / nodalPeriod / revolutionsPerCycle;
  if (rotations <= 0) return null;

  if (drift / rotations >= SYNCHRONOUS_DRIFT_DEGREES_PER_ROTATION) return null;
  // Only a track that closes in a single turn of the primary is named this way.
  if (cycleRotations !== 1) return null;

  if (revolutionsPerRotation === 1) {
    return shape.circular && shape.equatorial ? "stationary" : "synchronous";
  }
  if (revolutionsPerRotation === 2) return "semi-synchronous";
  return null;
}

/** The width of a band, or null when either end is missing. */
function span(
  min: Parameters<typeof magnitudeOf>[0],
  max: Parameters<typeof magnitudeOf>[0],
): number | null {
  const low = magnitudeOf(min);
  const high = magnitudeOf(max);
  return low === null || high === null ? null : high - low;
}

/**
 * The adjectives the producer can reach and this cannot, named for the widget
 * that has to admit to them.
 *
 * <p>Exported as data rather than written into a sentence, so the reason and the
 * list cannot drift apart: reaching one means deleting it here and the caption
 * follows. Three just did.</p>
 *
 * <p>Sun-synchronous is the one left, and not for want of a recurrence: it is
 * decided by the solar times of the nodes, which this Uplink does not carry
 * because they are an angle with π at noon and the contract has no unit that
 * says "time of day". Publishing them as plain degrees would put a number on
 * screen that no operator could read as a clock.</p>
 */
export const UNREACHABLE_ADJECTIVES = ["sun-synchronous"] as const;
