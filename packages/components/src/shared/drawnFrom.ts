import {
  datedFrom,
  observedAt,
  type Reading,
  type TopicCurrency,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * The value of a reading that carries one, observed or held, for a figure
 * drawn either way and marked held through {@link drawnFrom}.
 */
export function lastValue<Payload>(
  reading: TopicCurrency<Payload>,
): Payload | undefined {
  return reading.state === "observed" || reading.state === "held"
    ? reading.value
    : undefined;
}

/**
 * How current a picture drawn from these readings is: held, as of the oldest
 * of them, when any one carrying a value is held. Pass it as a contributed
 * entry's `held`.
 */
export function drawnFrom(
  readings: readonly TopicCurrency<unknown>[],
): Reading<undefined> {
  return datedFrom(
    readings.map((reading) => ({
      state: reading.state,
      instant: observedAt(reading),
      grade: reading.state === "held" ? reading.grade : undefined,
    })),
    undefined,
  );
}
