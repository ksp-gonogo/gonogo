import type { StaleGrade, TopicReading } from "@ksp-gonogo/sitrep-client";

/**
 * The grade of a reading that is being HELD, or nothing when it is current.
 *
 * For the figures a widget draws by hand rather than through `<Unit>`: a badge,
 * a state word, a pair of counts in a template string. `Unit` reads the grade
 * off the reading itself and marks the number it draws; a hand-drawn figure has
 * to ask, and this is the one spelling of the question so four widgets do not
 * grow four.
 *
 * The GRADE and not a boolean, because the two staleness grades ask the
 * operator for opposite moves: a producer whose updates stopped arriving is
 * something to go and check, where the last reading before a blackout is
 * something to wait out. `StreamStatusBadge` already turns each into its own
 * word.
 */
export function heldGrade<T>(reading: TopicReading<T>): StaleGrade | undefined {
  return reading.state === "stale" ? reading.grade : undefined;
}
