using Sitrep.Host.Comms;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// When a change held for home to hear of its craft lands: when home is in
    /// contact with the craft and its newest word of contact was sent at or
    /// after the charge, when home knows the craft is gone, or when home has
    /// declared it lost.
    /// </summary>
    public static class HeldCreditRelease
    {
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
