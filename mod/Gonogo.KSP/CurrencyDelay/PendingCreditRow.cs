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
    /// A held change that landed on one of home's Lost declarations: the
    /// declaration's number with the craft names it, so a change made against a
    /// withdrawn declaration can be found again.
    /// </summary>
    public sealed class LandedOnLost
    {
        public LandedOnLost(DelayedCurrency currency, double baseAmount, string originVesselId, int lostSeq, double landedUt, double? appliedDelta = null)
        {
            AppliedDelta = appliedDelta;
            Currency = currency;
            BaseAmount = baseAmount;
            OriginVesselId = originVesselId ?? "";
            LostSeq = lostSeq;
            LandedUt = landedUt;
        }

        public DelayedCurrency Currency { get; }
        public double BaseAmount { get; }
        public string OriginVesselId { get; }
        public int LostSeq { get; }
        public double LandedUt { get; }

        /// <summary>
        /// The change the balance actually took when the row was replayed, which the game's own
        /// clamp and reputation curve make different from <see cref="BaseAmount"/>; null until it
        /// is replayed. A refund reverses this, not the base amount.
        /// </summary>
        public double? AppliedDelta { get; internal set; }
    }

    /// <summary>
    /// Science held off the books under one of home's Lost declarations: the
    /// row as it was held and the declaration's number, so it can be given back
    /// if the declaration is withdrawn.
    /// </summary>
    public sealed class ForfeitedScience
    {
        public ForfeitedScience(double baseAmount, string originVesselId, string originDescription, int lostSeq)
        {
            BaseAmount = baseAmount;
            OriginVesselId = originVesselId ?? "";
            OriginDescription = originDescription ?? "";
            LostSeq = lostSeq;
        }

        public double BaseAmount { get; }
        public string OriginVesselId { get; }
        public string OriginDescription { get; }
        public int LostSeq { get; }
    }

    /// <summary>
    /// A single delayed-currency credit awaiting its reveal-UT.
    ///
    /// BaseAmount is the base requested amount, pre-clamp (e.g. the value
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
        /// <summary>The instant the row is due, or positive infinity while it is held: see <see cref="HeldSinceUt"/>.</summary>
        public double RevealUt { get; }
        public string OriginVesselId { get; }
        public string OriginDescription { get; }

        /// <summary>
        /// For a row held for home to hear of its craft, the instant it was
        /// charged; null for a row due at <see cref="RevealUt"/>. A held row
        /// lands when the ledger releases it: see <c>PendingCreditLedger.ReleaseHeld</c>.
        /// </summary>
        public double? HeldSinceUt { get; }

        /// <summary>The number of the home Lost declaration this row landed on, or 0 for a row that did not land on one.</summary>
        public int LostSeq { get; }

        public PendingCreditRow(
            DelayedCurrency currency,
            double baseAmount,
            double revealUt,
            string originVesselId,
            string originDescription,
            double? heldSinceUt = null,
            int lostSeq = 0)
        {
            LostSeq = lostSeq;
            Currency = currency;
            BaseAmount = baseAmount;
            RevealUt = heldSinceUt == null ? revealUt : double.PositiveInfinity;
            OriginVesselId = originVesselId ?? "";
            OriginDescription = originDescription ?? "";
            HeldSinceUt = heldSinceUt;
        }

        /// <summary>A row held from <paramref name="heldSinceUt"/> until home hears of its craft.</summary>
        public static PendingCreditRow Held(
            DelayedCurrency currency,
            double baseAmount,
            double heldSinceUt,
            string originVesselId,
            string originDescription) =>
            new PendingCreditRow(currency, baseAmount, double.PositiveInfinity, originVesselId, originDescription, heldSinceUt);

        /// <summary>This row due at <paramref name="revealUt"/>, held or not.</summary>
        public PendingCreditRow DueAt(double revealUt) =>
            new PendingCreditRow(Currency, BaseAmount, revealUt, OriginVesselId, OriginDescription, lostSeq: LostSeq);

        /// <summary>This row marked as landed on Lost declaration number <paramref name="lostSeq"/>.</summary>
        public PendingCreditRow OnDeclaration(int lostSeq) =>
            new PendingCreditRow(Currency, BaseAmount, RevealUt, OriginVesselId, OriginDescription, HeldSinceUt, lostSeq);
    }
}
