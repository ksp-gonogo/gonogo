import {
  NULL_DISPLAY,
  resolveCurrency,
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";

/**
 * One career balance on the header rail: the figure, or the null token beside
 * the currency's symbol, so three absent balances still say which is which.
 */
export function Balance<UnitSymbol extends string>({
  balance,
  unit,
}: {
  balance: UnitValue<UnitSymbol>;
  unit: UnitSymbol;
}) {
  if (resolveCurrency(balance).shown == null) {
    return (
      <>
        {NULL_DISPLAY}
        <Unit>{unit}</Unit>
      </>
    );
  }
  return <Unit value={balance} />;
}
