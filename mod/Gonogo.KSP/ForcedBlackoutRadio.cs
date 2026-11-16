using System.Collections.Generic;
using Sitrep.Host.Comms;

namespace Gonogo.KSP
{
    /// <summary>
    /// The active craft's radio reading as the contact plan receives it while the dev
    /// tools force a blackout: link down, no strength and no hops, the same reading a
    /// craft that has lost its link sends. The plan then shows <c>comms.path</c> no
    /// hops, <c>comms.route</c> no live route and <c>comms.delay</c> no measured delay,
    /// by the rule it already applies to a real loss.
    /// </summary>
    internal static class ForcedBlackoutRadio
    {
        private static readonly IReadOnlyList<RadioHop> NoHops = new RadioHop[0];

        /// <summary>
        /// <paramref name="real"/> itself when no blackout is forced, so the override
        /// changes nothing while it is off.
        /// </summary>
        internal static ContactRadio? Apply(ContactRadio? real, bool forcingBlackout)
        {
            if (!forcingBlackout || real == null)
            {
                return real;
            }

            return new ContactRadio(real.CraftId, false, 0.0, real.Degrade, NoHops, real.Quantity);
        }
    }
}
