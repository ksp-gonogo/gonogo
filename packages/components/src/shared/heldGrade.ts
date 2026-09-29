import type { HeldGrade, TopicReading } from "@ksp-gonogo/sitrep-client";

/**
 * The stale grade of a held reading, for a figure drawn without `<Unit>`. A
 * grade, not a boolean: a stopped producer is something to check, a blackout
 * something to wait out.
 */
export function heldGrade<Payload>(
  reading: TopicReading<Payload>,
): HeldGrade | undefined {
  return reading.state === "held" ? reading.grade : undefined;
}
