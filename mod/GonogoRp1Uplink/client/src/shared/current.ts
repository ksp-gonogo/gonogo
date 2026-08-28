import type { Reading } from "@ksp-gonogo/sitrep-sdk";

/**
 * The value where one is current.
 *
 * <para>A ground fact read while the link is down is still the last thing the
 * space centre said, and every `rp1.*` channel is TrueNow, so a reckonable
 * reading is as good as an observed one here.</para>
 */
export function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}
