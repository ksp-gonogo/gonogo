using Sitrep.Host.Comms;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>What becomes of a held change at one look at home's view of its craft.</summary>
    public enum HeldOutcome
    {
        Waits,
        Lands,

        /// <summary>It never reaches the books: science whose craft home knows has gone without word of it.</summary>
        Drops,

        /// <summary>
        /// It is off the books while home's Lost declaration of the craft stands: science that
        /// is given back if the declaration is withdrawn.
        /// </summary>
        Forfeits,
    }

    /// <summary>What becomes of science forfeited to a Lost declaration at one look at home's view of its craft.</summary>
    public enum ForfeitFate
    {
        Keep,
        Restore,
        Discard,
    }

    /// <summary>
    /// When a change held for home to hear of its craft lands: when home is in
    /// contact with the craft and its newest word of contact was sent at or
    /// after the charge, when home knows the craft is gone, or when home has
    /// declared it lost.
    ///
    /// <para>Science is held the same way and lands only on word from the
    /// craft sent at or after it was earned. It is forfeited while home's
    /// Lost declaration of the craft stands, and dropped when home knows it has
    /// gone with no such word, since the data never left it.</para>
    /// </summary>
    public static class HeldCreditRelease
    {
        /// <summary>What becomes of a held change of <paramref name="currency"/> now.</summary>
        /// <param name="heldSinceUt">The instant the change was charged or earned, in the craft's own time.</param>
        /// <param name="view">Home's view of the craft, or null while no word of it has reached home.</param>
        public static HeldOutcome Outcome(DelayedCurrency currency, double heldSinceUt, HomeCraftView? view)
        {
            if (currency != DelayedCurrency.Science)
            {
                return Lands(heldSinceUt, view) ? HeldOutcome.Lands : HeldOutcome.Waits;
            }
            if (view is not HomeCraftView home)
            {
                return HeldOutcome.Waits;
            }
            var heard = home.LastContactUt >= heldSinceUt;
            if ((home.Contact == CentreContactState.InContact || home.Contact == CentreContactState.Gone) && heard)
            {
                return HeldOutcome.Lands;
            }
            if (home.Contact == CentreContactState.Gone)
            {
                return HeldOutcome.Drops;
            }
            return home.Verdict == HomeVerdictState.Lost ? HeldOutcome.Forfeits : HeldOutcome.Waits;
        }

        /// <summary>
        /// What becomes of science forfeited under Lost declaration number <paramref name="lostSeq"/>
        /// at this look at home's view of its craft: given back once that declaration is withdrawn
        /// or has been replaced, discarded when home knows the craft has gone, kept otherwise.
        /// </summary>
        public static ForfeitFate FateOfForfeit(int lostSeq, HomeCraftView? view)
        {
            if (view is not HomeCraftView home)
            {
                return ForfeitFate.Keep;
            }
            if (home.Contact == CentreContactState.Gone || home.Verdict == HomeVerdictState.Gone)
            {
                return ForfeitFate.Discard;
            }
            return home.LostSeq > lostSeq || home.Verdict == HomeVerdictState.Nominal
                ? ForfeitFate.Restore
                : ForfeitFate.Keep;
        }

        /// <param name="heldSinceUt">The instant the change was charged, in the craft's own time.</param>
        /// <param name="view">Home's view of the craft, or null while no word of it has reached home.</param>
        public static bool Lands(double heldSinceUt, HomeCraftView? view)
        {
            if (view is not HomeCraftView home)
            {
                return false;
            }
            /*
             * Contact alone is not news of the charge: for one of home's delays
             * after a craft goes silent, home still holds word of contact sent
             * before it. Only word sent at or after the charge carries it.
             */
            return home.Verdict == HomeVerdictState.Lost
                || home.Contact == CentreContactState.Gone
                || (home.Contact == CentreContactState.InContact && home.LastContactUt >= heldSinceUt);
        }

        /// <summary>The number of home's Lost declaration a change landing now lands on, or 0 when it lands on anything else.</summary>
        public static int DeclarationOf(HomeCraftView? view) =>
            view is HomeCraftView home && home.Verdict == HomeVerdictState.Lost ? home.LostSeq : 0;
    }
}
