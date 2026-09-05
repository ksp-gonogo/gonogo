import type { Reading } from "@ksp-gonogo/sitrep-sdk";

/**
 * The value a judgement may be drawn from: current, or modelled forward to the
 * frame. A stale reading with no model gives nothing, because an attitude to the
 * airflow cannot be dated: an operator reads a stall band as the situation NOW.
 *
 * Shared by the readout widget and the descent-envelope overlay, so the two
 * cannot end up disagreeing about when a reading stops counting.
 */
export function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.reckoning === "available") return reading.reckoned.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}
