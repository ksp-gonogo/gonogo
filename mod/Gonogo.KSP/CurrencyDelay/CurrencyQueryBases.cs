namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// The base amount a stock currency change was ASKED for, remembered from
    /// the modifier query that precedes it so the following <c>On*Changed</c>
    /// can read a pre-clamp figure instead of a post-clamp difference.
    ///
    /// <para><b>Why this is a class and not three fields on the interceptor.</b>
    /// It used to be three fields plus one shared reason, on the premise that
    /// "the query and its matching On*Changed fire synchronously back to back
    /// within one mutator call, with nothing else able to interleave". Something
    /// does interleave. Between the two, the mutator also fires
    /// <c>OnCurrencyModified</c>, and a subscriber to THAT is free to run a
    /// query of its own: a career overhaul that awards its own extra currency
    /// off a science award prices that award through a fresh query, carrying the
    /// same <c>ScienceTransmission</c> reason and zero science. Landing in one
    /// shared slot, it displaced the real base, the science change resolved with
    /// a base of zero, and the away arm silently neutralised nothing and
    /// credited nothing. Measured on the rig 2026-08-27, request
    /// <c>away-arm-first-1</c>: the science landed at once with the shadow left
    /// behind and no pending row, and every correlation list read empty, so
    /// nothing named the failure.
    /// </para>
    ///
    /// <para>So a query is evidence about a currency only when it carries a
    /// non-zero amount OF THAT CURRENCY, and each currency keeps its own slot.
    /// A query about somebody else's currency now passes straight through the
    /// two it says nothing about.</para>
    ///
    /// <para>Slots also carry the UT they were captured at and expire with it.
    /// A query that no change follows is ordinary (pricing a purchase for
    /// display runs one), and without expiry the amount it quoted would sit in
    /// the slot until some later change of the same reason picked it up as its
    /// own base.</para>
    ///
    /// <para>Pure: no GameEvents, no KSP/Unity types, unit-tested
    /// unconditionally.</para>
    /// </summary>
    public sealed class CurrencyQueryBases
    {
        /// <summary>
        /// Game-UT seconds a captured base stays claimable. Shares
        /// <see cref="StockCurrencyStateMachine.AttributionWindowUt"/>'s value and
        /// its reasoning: a query and the change it describes are one synchronous
        /// call apart, so anything wider is another event entirely.
        /// </summary>
        public const double FreshnessWindowUt = StockCurrencyStateMachine.AttributionWindowUt;

        private struct Slot
        {
            public bool Held;
            public StockTransactionReason Reason;
            public double Amount;
            public double Ut;
        }

        private Slot _funds;
        private Slot _science;
        private Slot _reputation;

        /// <summary>
        /// Records one modifier query's per-currency inputs. A zero input says
        /// nothing about its currency and deliberately leaves that currency's
        /// slot alone.
        /// </summary>
        public void Capture(StockTransactionReason reason, double funds, double science, double reputation, double ut)
        {
            CaptureOne(ref _funds, reason, funds, ut);
            CaptureOne(ref _science, reason, science, ut);
            CaptureOne(ref _reputation, reason, reputation, ut);
        }

        /// <summary>
        /// Reads and clears the base captured for this reason+currency, or
        /// returns <paramref name="fallback"/> when nothing fresh matches. The
        /// fallback is the caller's own shadow difference, which is right
        /// whenever the change was not clamped.
        /// </summary>
        public double Consume(StockTransactionReason reason, CurrencyKind currency, double ut, double fallback)
        {
            switch (currency)
            {
                case CurrencyKind.Funds: return ConsumeOne(ref _funds, reason, ut, fallback);
                case CurrencyKind.Science: return ConsumeOne(ref _science, reason, ut, fallback);
                case CurrencyKind.Reputation: return ConsumeOne(ref _reputation, reason, ut, fallback);
                default: return fallback;
            }
        }

        private static void CaptureOne(ref Slot slot, StockTransactionReason reason, double amount, double ut)
        {
            if (amount == 0.0 || double.IsNaN(amount) || double.IsInfinity(amount))
            {
                return;
            }

            slot.Held = true;
            slot.Reason = reason;
            slot.Amount = amount;
            slot.Ut = ut;
        }

        private static double ConsumeOne(ref Slot slot, StockTransactionReason reason, double ut, double fallback)
        {
            if (!slot.Held || slot.Reason != reason || ut - slot.Ut > FreshnessWindowUt)
            {
                return fallback;
            }

            slot.Held = false;
            return slot.Amount;
        }
    }
}
