import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";

/**
 * One career balance on the header rail: the figure, or the null token beside
 * the currency's symbol, so three absent balances still say which is which.
 */
export function Balance<U extends string>({
  balance,
  unit,
}: {
  balance: Value<U> | null | undefined;
  unit: U;
}) {
  if (balance === null || balance === undefined) {
    return (
      <>
        {NULL_DISPLAY}
        <Unit>{unit}</Unit>
      </>
    );
  }
  return <Unit value={balance} />;
}
