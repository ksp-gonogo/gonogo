import type { TopicReading } from "@ksp-gonogo/sitrep-sdk";

/**
 * The value where one is current.
 *
 * <para>A space-centre fact read while the link is down is still the last thing
 * the space centre said, and every `rp1.*` channel a widget reads through this is
 * held at the home command rather than aboard a craft, so a reading carrying a
 * model is as good as an observed one.</para>
 *
 * <para><b>Not for `rp1.avionics`.</b> That one is Delayed, and its subject is a
 * craft rather than a building: accepting a modelled reading there would show a
 * control state the signal has not brought the operator yet. It is read by a
 * contribution off the frame store instead, which gates it, and nothing routes
 * it through here.</para>
 */
export function current<T>(reading: TopicReading<T>): T | undefined {
  if (reading.reckoning.status === "available") return reading.reckoning.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}
