using System.Collections.Generic;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>One decided reveal step: which balance, how much (the BASE amount, pre-clamp).</summary>
    public readonly struct RevealApplication
    {
        public DelayedCurrency Currency { get; }
        public double BaseAmount { get; }

        public RevealApplication(DelayedCurrency currency, double baseAmount)
        {
            Currency = currency;
            BaseAmount = baseAmount;
        }
    }

    /// <summary>
    /// The pure decision core behind RevealApplier: turns a batch of matured
    /// <see cref="PendingCreditRow"/>s (already popped off <see cref="PendingCreditLedger"/> by
    /// RevealUt) into the ordered sequence of currency applications the glue should replay. No
    /// GameEvents, no KSP/Unity types, no ConfigNode - same discipline as StockCurrencyDecision.cs,
    /// and deliberately independent of PendingCreditLedger's own ConfigNode round-trip so this
    /// stays unconditionally testable even on a checkout with no KspManaged reference DLLs.
    /// </summary>
    public static class RevealDecision
    {
        /// <summary>
        /// Preserves the matured rows' order exactly (PendingCreditLedger.PopMatured already
        /// returns them in enqueue order). A zero base amount is dropped rather than replayed -
        /// StockCurrencyDecision.BuildCredit already refuses to enqueue one, so a row with one here
        /// can only be a defensive no-op, never a legitimate reveal.
        /// </summary>
        public static List<RevealApplication> Plan(IReadOnlyList<PendingCreditRow> maturedRows)
        {
            var plan = new List<RevealApplication>(maturedRows?.Count ?? 0);
            if (maturedRows == null)
            {
                return plan;
            }

            foreach (var row in maturedRows)
            {
                if (row == null || row.BaseAmount == 0.0)
                {
                    continue;
                }

                plan.Add(new RevealApplication(row.Currency, row.BaseAmount));
            }

            return plan;
        }
    }
}
