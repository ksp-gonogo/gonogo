import { type Value, value } from "@ksp-gonogo/sitrep-sdk";

/**
 * The stored charge carried forward from the last report received, at the net
 * rate that report carried. Present only while the figures are held.
 */
export interface ChargeProjection {
  /** The modelled stored charge now, never below zero or above capacity. */
  stored: number;
  /** Seconds from now until the store is empty; present only while the model still has charge left and is draining. */
  secondsToEmpty: number | undefined;
  /** The UT the model has the store reaching zero at, once that is behind now. */
  emptySinceUt: Value<"ut"> | undefined;
}

/**
 * What a held report says the stored charge is now, holding its net rate
 * unchanged since it was received. Undefined while any input is missing or
 * not finite, so an absent figure is never drawn as zero.
 *
 * The rate is the one report's: a change of light, a switch thrown or a
 * generator starting after it is not in the model.
 */
export function projectCharge({
  stored,
  capacity,
  rate,
  asOfUt,
  nowUt,
}: Readonly<{
  stored: number | undefined;
  capacity: number | undefined;
  rate: number | undefined;
  asOfUt: Value<"ut"> | undefined;
  nowUt: Value<"ut"> | undefined;
}>): ChargeProjection | undefined {
  if (
    stored === undefined ||
    capacity === undefined ||
    rate === undefined ||
    !asOfUt?.isFinite() ||
    !nowUt?.isFinite() ||
    ![stored, capacity, rate].every(Number.isFinite)
  ) {
    return undefined;
  }
  const level = value("units", stored);
  const full = value("units", capacity);
  const perSecond = value("units/s", rate);
  const unmoved = level.plus(perSecond.times(nowUt.minus(asOfUt).max(0)));
  const clamped = unmoved.max(0).min(full);
  if (!perSecond.isNegative()) {
    return {
      stored: Number(clamped),
      secondsToEmpty: undefined,
      emptySinceUt: undefined,
    };
  }
  if (unmoved.isPositive()) {
    return {
      stored: Number(clamped),
      secondsToEmpty: Number(unmoved.per(perSecond.abs())),
      emptySinceUt: undefined,
    };
  }
  return {
    stored: 0,
    secondsToEmpty: undefined,
    emptySinceUt: asOfUt.plus(level.per(perSecond.abs())),
  };
}
