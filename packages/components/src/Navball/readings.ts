import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";

/** The last real observation behind a reading, never a modelled value. */
export function lastObserved<Payload>(
  reading: TopicReading<Payload>,
): Payload | undefined {
  switch (reading.state) {
    case "observed":
    case "stale":
      return reading.value;
    default:
      return undefined;
  }
}

/** An attitude angle's magnitude, whether it arrives as a bare number or a quantity. */
export function numericOrNull(v: unknown): number | null {
  return magnitudeOf(asQuantityish(v));
}
