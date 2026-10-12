import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { UnitValue } from "../readingCurrency";

/**
 * A figure worked out from the one-way delay (the delay itself, twice it),
 * carrying the delay reading's currency, so a `comms.delay` that has gone
 * quiet draws every figure derived from it held. Useful for showing the
 * operator a delay figure that is marked held while the delay reading is. Used
 * by {@link ControlDelayStream} and {@link SignalDelayBadge}.
 */
export function withDelayCurrency(
  figure: Value<"s">,
  delay: Reading<Value<"s">> | null | undefined,
): UnitValue<"s"> {
  if (delay?.state !== "held") return figure;
  return { ...delay, value: figure };
}
