import { useTelemetry } from "@ksp-gonogo/core";
import { useUtNow } from "@ksp-gonogo/sitrep-client";
import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  type ChargeTrend,
  chargeTrend,
  EMPTY_TREND,
  trendFromProjection,
} from "./chargeTrend";
import { type ChargeProjection, projectCharge } from "./powerPrediction";

/**
 * Where the stored charge is heading, from whichever report is the newest.
 * While the read behind the figures is current it is the trend of the smoothed
 * net rate, or empty at a measured zero. While that read is held it is the
 * last report carried forward at its own net rate, and `held` says since when.
 */
export function useChargeOutlook({
  isCharge,
  netKnown,
  net,
  smoothedNet,
  storage,
}: Readonly<{
  isCharge: boolean;
  /** The net rate is known: measured, or summed from the itemised parts. */
  netKnown: boolean;
  net: number;
  smoothedNet: number | undefined;
  storage: { amount: number; maxAmount: number } | null;
}>): {
  trend: ChargeTrend | undefined;
  projection: ChargeProjection | undefined;
  /** The UT of the last report received, while the read behind the figures is held. */
  heldSinceUt: Value<"ut"> | undefined;
  /** How long ago that report was, from the craft's present estimate; zero when the clock is behind it. */
  heldFor: Value<"s"> | undefined;
} {
  const partsReading = useTelemetry("vessel.parts");
  const nowSeconds = useUtNow();
  const nowUt = nowSeconds === undefined ? undefined : value("ut", nowSeconds);
  const heldSinceUt =
    partsReading.state === "held" ? partsReading.asOfUt : undefined;

  const heldFor =
    heldSinceUt && nowUt ? nowUt.minus(heldSinceUt).max(0) : undefined;
  if (!isCharge || !storage || storage.maxAmount <= 0) {
    return { trend: undefined, projection: undefined, heldSinceUt, heldFor };
  }
  if (heldSinceUt !== undefined) {
    const projection = netKnown
      ? projectCharge({
          stored: storage.amount,
          capacity: storage.maxAmount,
          rate: net,
          asOfUt: heldSinceUt,
          nowUt,
        })
      : undefined;
    return {
      trend: projection ? trendFromProjection(net, projection) : undefined,
      projection,
      heldSinceUt,
      heldFor,
    };
  }
  const live = chargeTrend(smoothedNet, storage.amount, storage.maxAmount);
  return {
    trend: live ?? (storage.amount <= 0 ? EMPTY_TREND : undefined),
    projection: undefined,
    heldSinceUt,
    heldFor,
  };
}
