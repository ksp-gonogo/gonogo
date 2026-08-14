namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// Which stock balance a pending credit applies to.
    /// </summary>
    public enum DelayedCurrency
    {
        Funds,
        Science,
        Reputation,
    }

    /// <summary>
    /// A single delayed-currency credit awaiting its reveal-UT.
    ///
    /// BaseAmount is the BASE requested amount, pre-clamp (e.g. the value
    /// read off <c>OnCurrencyModifierQuery.input</c>), never the clamped or
    /// curve-normalised delta that actually landed at earn-time. Replaying
    /// the base at reveal lets the game re-apply the clamp and (for
    /// reputation) the curve normalisation against the reveal-time balance,
    /// which is the only way the delayed credit nets out correctly, see the
    /// currency-delay feasibility study's reputation clamp-drift analysis.
    ///
    /// Kept in its own file, separate from PendingCreditLedger's ConfigNode
    /// round-trip, so this type - and anything built on it, like
    /// RevealDecision.Plan and ScienceChunkCredit - compiles and is
    /// unit-tested with no KspManaged reference DLLs at all.
    /// </summary>
    public sealed class PendingCreditRow
    {
        public DelayedCurrency Currency { get; }
        public double BaseAmount { get; }
        public double RevealUt { get; }
        public string OriginVesselId { get; }
        public string OriginDescription { get; }

        public PendingCreditRow(
            DelayedCurrency currency,
            double baseAmount,
            double revealUt,
            string originVesselId,
            string originDescription)
        {
            Currency = currency;
            BaseAmount = baseAmount;
            RevealUt = revealUt;
            OriginVesselId = originVesselId ?? "";
            OriginDescription = originDescription ?? "";
        }
    }
}
