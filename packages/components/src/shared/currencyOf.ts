import type { CarriedCurrency, Reading } from "@ksp-gonogo/sitrep-sdk";

/** What a reading says about how current it is, for dating a figure computed from it with `datedFrom`. */
export function currencyOf(reading: Reading<unknown>): CarriedCurrency {
  return {
    state: reading.state,
    instant: reading.state === "held" ? reading.asOfUt : reading.atUt,
    grade: reading.state === "held" ? reading.grade : undefined,
  };
}
