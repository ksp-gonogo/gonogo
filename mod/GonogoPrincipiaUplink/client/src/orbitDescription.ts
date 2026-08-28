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
 * <p><b>Four adjectives are deliberately missing, and one clause never gets
 * built.</b> Synchronous, stationary, semi-synchronous and sun-synchronous all
 * need a ground-track recurrence, which this Uplink does not ask the producer
 * for: asking means handing it a recurrence hypothesis that it validates behind
 * seven checks, each of which ends the game when it fails. So the phrase here is
 * a true description that is sometimes less specific than the producer's, and
 * the widget says which four words it cannot reach rather than letting an
 * operator infer that a synchronous orbit is not one.</p>
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
 * The four adjectives the producer can reach and this cannot, named for the
 * widget that has to admit to them.
 *
 * <p>Exported as data rather than written into a sentence, so the reason and the
 * list cannot drift apart: adding one back means deleting it here and the
 * caption follows.</p>
 */
export const UNREACHABLE_ADJECTIVES = [
  "synchronous",
  "stationary",
  "semi-synchronous",
  "sun-synchronous",
] as const;
