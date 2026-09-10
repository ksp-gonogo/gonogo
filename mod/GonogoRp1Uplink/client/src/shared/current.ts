import type { Reading } from "@ksp-gonogo/sitrep-sdk";

/**
 * The value where one is current.
 *
 * <para>A ground fact read while the link is down is still the last thing the
 * space centre said, and every `rp1.*` channel a widget reads through this is
 * TrueNow, so a reading carrying a model is as good as an observed one.</para>
 *
 * <para><b>Not for `rp1.avionics`.</b> That one is Delayed, and its subject is a
 * craft rather than a building: accepting a modelled reading there would show a
 * control state the signal has not brought the operator yet. It is read by a
 * contribution off the frame store instead, which gates it, and nothing routes
 * it through here.</para>
 */
export function current<T>(reading: Reading<T>): T | undefined {
  if (reading.reckoning === "available") return reading.reckoned.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}
