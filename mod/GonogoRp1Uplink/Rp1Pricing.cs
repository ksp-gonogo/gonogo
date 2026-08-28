// What RP-1 will actually charge for a vehicle, and whether the career can bear
// it. No compile-time reference to RP0.dll, the same arm's-length reflection
// pattern as Rp1ScReflection, whose header carries the provenance rules this file
// follows.
//
// WHY IT IS SHARED RATHER THAN COPIED. Two commands now buy a vehicle: repeating
// a design the space centre holds, and starting one from a craft file. The money
// step is the one part of either that cannot be got wrong quietly.
// KCTUtilities.SpendFunds performs NO affordability test: its whole body is a
// Funding.Instance.AddFunds of the negative amount, and the test lives in
// VesselBuildValidator.ProcessFundsChecks, which is the popup-driven half neither
// command calls. So a second copy of this that drifted would not fail a build, it
// would drive a career into negative funds and RP-1 would never say a word.
//
// THE AUTHORITY ON PRICE IS RP-1'S, NOT THE STORED COST.
// CurrencyModifierQueryRP0.RunQuery is what RP-1's own validator asks, and it is
// asked here for the same reason: leaders and strategies modify what a vessel
// purchase actually costs, so the field on the vehicle is a list price rather
// than the charge. The query fires GameEvents.Modifiers.OnCurrencyModifierQuery,
// which is a broadcast, so it is run ONCE per operator press on the main thread,
// exactly where and as often as RP-1's own window runs it. It is never run from a
// gate or a capture.
using System;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// RP-1's price for a vehicle purchase, and the career's balance beside it.
    /// </summary>
    public sealed class Rp1Pricing
    {
        private const string CurrencyQueryTypeName = "RP0.CurrencyModifierQueryRP0";
        private const string TransactionReasonsTypeName = "RP0.TransactionReasonsRP0";
        private const string CurrencyTypeName = "RP0.CurrencyRP0";

        /// <summary>RP-1's transaction reason for buying a vehicle, the one its own validator prices against.</summary>
        private const string VesselPurchaseReason = "VesselPurchase";

        /// <summary>The currency a vessel purchase is denominated in.</summary>
        private const string FundsCurrency = "Funds";

        private readonly Type? _currencyQuery;
        private readonly Type? _transactionReasons;
        private readonly Type? _currency;

        public Rp1Pricing()
        {
            _currencyQuery = Rp1Types.Find(CurrencyQueryTypeName);
            _transactionReasons = Rp1Types.Find(TransactionReasonsTypeName);
            _currency = Rp1Types.Find(CurrencyTypeName);
        }

        /// <summary>
        /// Whether the pricing types resolved. A caller that could add to a build
        /// list without this is one that overdraws a career, so a command
        /// declaring itself available must include this in the test.
        /// </summary>
        public bool IsAvailable =>
            _currencyQuery != null && _transactionReasons != null && _currency != null;

        /// <summary>
        /// What RP-1 would charge for this vehicle, and whether the career can
        /// cover it.
        ///
        /// <para>A refusal comes back through <paramref name="failure"/> rather
        /// than as an unaffordable verdict, because "the price could not be
        /// computed" and "the price is too high" are different things to tell an
        /// operator, and only the second is about their money.</para>
        /// </summary>
        public double Price(object vessel, out bool affordable, out CommandResult? failure)
        {
            affordable = false;
            failure = null;
            try
            {
                var totalCost = Rp1Types.InstanceMethod(vessel, "GetTotalCost", 0);
                var runQuery = Rp1Types.StaticMethod(_currencyQuery!, "RunQuery", 4);
                var reason = Enum.Parse(_transactionReasons!, VesselPurchaseReason);
                var funds = Enum.Parse(_currency!, FundsCurrency);
                if (totalCost == null || runQuery == null)
                {
                    failure = Unreadable(null);
                    return 0.0;
                }

                var listPrice = Rp1Types.ToDouble(totalCost.Invoke(vessel, null)) ?? 0.0;
                var query = runQuery.Invoke(null, new object[] { reason, -listPrice, 0.0, 0.0 });
                var canAfford = query?.GetType().GetMethod("CanAfford", new[] { _currency! });
                var getTotal = query?.GetType().GetMethod("GetTotal", new[] { _currency!, typeof(bool) });
                if (query == null || canAfford == null)
                {
                    failure = Unreadable(null);
                    return 0.0;
                }

                affordable = canAfford.Invoke(query, new[] { funds }) is bool ok && ok;

                // The charge RP-1 arrived at, not the list price: leaders and
                // strategies move it, and a refusal that quoted the wrong number
                // would send an operator looking for funds they already have. The
                // query states it as a negative delta, so it is negated back.
                var charged = getTotal == null
                    ? (double?)null
                    : Rp1Types.ToDouble(getTotal.Invoke(query, new object[] { funds, true }));
                return charged.HasValue ? -charged.Value : listPrice;
            }
            catch (Exception ex)
            {
                failure = Unreadable(ex);
                return 0.0;
            }
        }

        /// <summary>
        /// The refusal for a price that could not be computed. It REFUSES, and
        /// that direction is the whole point: RP-1's SpendFunds does no
        /// affordability test of its own, so proceeding on an unreadable price is
        /// how a career ends up in negative funds with nothing to show for it.
        /// </summary>
        private static CommandResult Unreadable(Exception? ex) => CommandResult.Fail(
            CommandErrorCode.ModeUnavailable,
            "RP-1's own price for this vehicle could not be read, so the build was not started"
            + (ex == null ? "" : ": " + Rp1Types.ExceptionReason(ex)));

        /// <summary>
        /// The career's funds, for the number beside a refusal only. Read off
        /// KSP's own Funding rather than anything of RP-1's, because RP-1 keeps
        /// no balance of its own; absent when it cannot be read, which costs a
        /// refusal its second number and nothing else.
        /// </summary>
        public static double? FundsBalance()
        {
            var funding = Rp1Types.Find("Funding");
            if (funding == null)
            {
                return null;
            }
            return Rp1Types.ReadDouble(Rp1Types.StaticValue(funding, "Instance"), "Funds");
        }
    }
}
