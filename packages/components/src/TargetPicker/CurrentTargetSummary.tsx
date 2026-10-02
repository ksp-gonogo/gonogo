import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { Button, Tooltip, Unit } from "@ksp-gonogo/ui-kit";
import {
  CurrentSummary,
  CurrentSummaryDistance,
  CurrentSummaryMeta,
  CurrentSummaryName,
  CurrentSummaryTop,
  Hint,
} from "./styles";

/** The current target's name, range, kind and closing rate, with the control that clears it. */
export function CurrentTargetSummary({
  tarName,
  tarType,
  tarDistance,
  tarRelVel,
  rangeR,
  closingRateR,
  onClear,
}: Readonly<{
  tarName: string | undefined;
  tarType: string | undefined;
  tarDistance: number | undefined;
  tarRelVel: number | undefined;
  rangeR: Reading<Value<"m">>;
  closingRateR: Reading<Value<"m/s">>;
  onClear: () => void;
}>) {
  return (
    <CurrentSummary>
      {tarName === undefined ? (
        <Hint>No target set in KSP.</Hint>
      ) : (
        <>
          <CurrentSummaryTop>
            <Tooltip text={tarName} announce={false}>
              <CurrentSummaryName>{tarName}</CurrentSummaryName>
            </Tooltip>
            {typeof tarDistance === "number" &&
              Number.isFinite(tarDistance) && (
                <CurrentSummaryDistance>
                  <Unit value={rangeR} />
                </CurrentSummaryDistance>
              )}
          </CurrentSummaryTop>
          <CurrentSummaryMeta>
            {tarType && <span>{tarType}</span>}
            {typeof tarRelVel === "number" && Number.isFinite(tarRelVel) && (
              <span>
                Δv <Unit value={closingRateR} decimals={2} />
              </span>
            )}
            <Button onClick={onClear} type="button">
              Clear target
            </Button>
          </CurrentSummaryMeta>
        </>
      )}
    </CurrentSummary>
  );
}
