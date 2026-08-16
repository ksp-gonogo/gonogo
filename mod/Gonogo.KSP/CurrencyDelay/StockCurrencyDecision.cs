using System;
using System.Collections.Generic;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// A local mirror of stock KSP's <c>TransactionReasons</c> enum (every
    /// named, non-composite member), kept as a plain C# enum with no
    /// dependency on the real type so the classification below compiles and
    /// is unit-tested with no KspManaged reference DLLs at all. The KSP-glue
    /// half of this subsystem (StockCurrencyInterceptor.cs) converts a live
    /// <c>TransactionReasons</c> value into one of these by name before
    /// calling in - the two enums share every member name so that mapping
    /// is a straight parse, never a hand-maintained switch.
    /// </summary>
    public enum StockTransactionReason
    {
        None,
        ContractAdvance,
        ContractReward,
        ContractPenalty,
        VesselRollout,
        VesselRecovery,
        VesselLoss,
        StrategyInput,
        StrategyOutput,
        StrategySetup,
        ScienceTransmission,
        StructureRepair,
        StructureCollapse,
        StructureConstruction,
        RnDTechResearch,
        RnDPartPurchase,
        Cheating,
        CrewRecruited,
        ContractDecline,
        Progression,
        Mission,
    }

    /// <summary>Where a currency change should be attributed for delay purposes.</summary>
    public enum CurrencyOrigin
    {
        /// <summary>Granted at KSC (or with no resolvable vessel): reveals instantly.</summary>
        Home,

        /// <summary>Earned somewhere with a known vessel: delayed to KSC light-time.</summary>
        Away,
    }

    /// <summary>
    /// Which stock balance a decision concerns. Deliberately a separate type
    /// from <see cref="DelayedCurrency"/> (PendingCreditLedger.cs): that
    /// file's OnSave/OnLoad round-trip touches the real KSP ConfigNode type,
    /// so it only compiles with KspManaged present, whereas this decision
    /// core has no such dependency and must compile unconditionally. The
    /// glue (StockCurrencyInterceptor.cs) converts between the two by name.
    /// </summary>
    public enum CurrencyKind
    {
        Funds,
        Science,
        Reputation,
    }

    /// <summary>
    /// A decided delayed credit, independent of <see cref="PendingCreditRow"/>
    /// for the same reason <see cref="CurrencyKind"/> is independent of
    /// <see cref="DelayedCurrency"/>: this type has to compile with no
    /// ConfigNode dependency. The glue converts one into the other before
    /// calling <c>PendingCreditLedger.Enqueue</c>.
    /// </summary>
    public readonly struct StockCurrencyCredit
    {
        public CurrencyKind Currency { get; }
        public double BaseAmount { get; }
        public double RevealUt { get; }
        public string OriginVesselId { get; }
        public string OriginDescription { get; }

        public StockCurrencyCredit(
            CurrencyKind currency,
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

    /// <summary>
    /// The pure decision core behind stock currency interception: which
    /// changes get delayed, and what pending credit a delayed one produces.
    /// No GameEvents, no Harmony, no live KSP calls, no KSP types at all -
    /// same discipline as KscLightTimeMath.cs and VesselScienceAggregator.cs.
    /// The KSP-glue half (StockCurrencyInterceptor.cs) subscribes to the real
    /// events, shadows the live balances, and calls into this.
    /// </summary>
    public static class StockCurrencyDecision
    {
        /// <summary>
        /// Live-confirmed (currency-delay-feasibility.md + followups.md):
        /// ScienceTransmission and VesselRecovery carry a resolvable vessel
        /// directly on their currency event. Stock lab transmission also
        /// lands here - it credits under ScienceTransmission too, just via a
        /// different KSP event (OnTriggeredDataTransmission rather than
        /// OnScienceRecieved), which is a glue-layer routing detail, not a
        /// different classification. VesselLoss (the crew-death reputation
        /// penalty) carries no vessel of its own - its "hasVessel" comes
        /// from correlating with a separate vessel-destruction event
        /// (StockCurrencyStateMachine.PushDeathVessel/TryClaimDeathVessel),
        /// not from anything on the reputation event itself.
        /// </summary>
        private static readonly HashSet<StockTransactionReason> AwayReasons = new HashSet<StockTransactionReason>
        {
            StockTransactionReason.ScienceTransmission,
            StockTransactionReason.VesselRecovery,
            StockTransactionReason.VesselLoss,
        };

        /// <summary>
        /// AWAY only when the reason is one of the vessel-bearing stock
        /// reasons AND the caller actually resolved a vessel for this
        /// change - a null/vessel-less source (some third-party mod awards,
        /// reverse-engineered recovery credit, a VesselLoss with no
        /// correlated death vessel) degrades to HOME rather than inventing
        /// an origin.
        /// </summary>
        public static CurrencyOrigin ClassifyOrigin(StockTransactionReason reason, bool hasVessel)
        {
            return AwayReasons.Contains(reason) && hasVessel ? CurrencyOrigin.Away : CurrencyOrigin.Home;
        }

        /// <summary>
        /// Builds the pending credit for a neutralised AWAY change, or null
        /// when there is nothing worth queuing (a zero base amount neutralises
        /// to nothing and would only clutter the ledger).
        ///
        /// <para><c>baseAmount</c> is stored verbatim - the value read off
        /// <c>OnCurrencyModifierQuery.GetInput(Currency)</c>, pre-clamp -
        /// never derived from <c>shadowBalance</c>. This is deliberate and
        /// load-bearing: reputation gains are curve-normalised against the
        /// CURRENT balance (<c>ModifyReputationDelta</c>), so a base of -10
        /// can apply as ~-18.7 depending on where reputation sits at the
        /// moment it lands. Reversing an already-applied delta would bake in
        /// whatever normalisation happened at EARN time; replaying the base
        /// at REVEAL time lets the game re-normalise against the
        /// reveal-time balance instead, which is the only way the credit
        /// nets out correctly. <c>shadowBalance</c> is accepted for
        /// traceability in <see cref="StockCurrencyCredit.OriginDescription"/>
        /// only - it must never feed into <c>BaseAmount</c>.</para>
        /// </summary>
        public static StockCurrencyCredit? BuildCredit(
            CurrencyKind currency,
            double baseAmount,
            double shadowBalance,
            string originVesselId,
            KscDelay delay,
            double nowUt,
            double silenceDeclarationSeconds)
        {
            if (baseAmount == 0.0)
            {
                return null;
            }

            var description = string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "{0} {1:+0.###;-0.###} (shadow {2:0.###})",
                currency,
                baseAmount,
                shadowBalance);

            return new StockCurrencyCredit(
                currency,
                baseAmount,
                delay.RevealUt(nowUt, silenceDeclarationSeconds),
                originVesselId ?? "",
                description);
        }
    }
}
