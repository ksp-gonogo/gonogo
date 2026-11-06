import {
  type CarriedCurrency,
  datedFrom,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";

/** How long until a planned burn, dated by the orbit (and target) the plan was computed from, so a held orbit draws it held. */
export function untilBurn(
  ut: Value<"ut">,
  currentUT: Value<"ut"> | undefined,
  from: readonly CarriedCurrency[] | undefined,
) {
  if (currentUT === undefined) return undefined;
  const duration = ut.minus(currentUT);
  return from === undefined ? duration : datedFrom(from, duration);
}
