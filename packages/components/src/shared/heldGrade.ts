import type { HeldGrade, TopicReading } from "@ksp-gonogo/sitrep-client";
import type { Reading } from "@ksp-gonogo/sitrep-sdk";

/**
 * The held grade of a held reading, for a figure drawn without `<Unit>`. A
 * grade, not a boolean: a stopped producer is something to check, a blackout
 * something to wait out.
 */
export function heldGrade<Payload>(
  reading: TopicReading<Payload> | Reading<Payload>,
): HeldGrade | undefined {
  return reading.state === "held" ? (reading.grade ?? "held") : undefined;
}
