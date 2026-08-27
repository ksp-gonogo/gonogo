using System;
using System.Collections.Generic;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// Finds the vessel an away currency event came from among the ones the game
    /// currently holds, and measures that one's route home.
    ///
    /// <para><b>The defect this exists to close.</b> The away-science arm was
    /// handed a live vessel on exactly one of its three entry points (the stock
    /// science lab). Every ordinary transmission arrives carrying a ProtoVessel
    /// and nothing else, and the arm answered <see cref="KscDelay.Unroutable"/>
    /// from a literal rather than asking whether that vessel was sitting in the
    /// roster all along. So a craft in a stable orbit with a working one-hop link
    /// home had its science held for the whole silence-declaration deadline:
    /// measured on the rig as 21,600 s against a hop worth about 13.</para>
    ///
    /// <para>Generic over the vessel type on purpose. The roster and the route
    /// read are both live-scene reads that cannot be entered headlessly at all,
    /// but the WALK - the half that was missing - takes an id and a sequence and
    /// needs nothing, so it compiles and is exercised on every checkout. Same
    /// discipline as <c>RoutedPathDelay</c> and <c>CommNetOcclusion</c>.</para>
    /// </summary>
    internal static class LiveOriginDelay
    {
        /// <param name="vesselId">The origin's persistent id, as the event reported it.</param>
        /// <param name="roster">Every vessel the game currently holds, loaded or on rails.</param>
        /// <param name="idOf">One entry's id, or null when that entry is torn down.</param>
        /// <param name="measure">The route read, run only for the entry that matched.</param>
        /// <returns>
        /// The matched vessel's measured delay, or <see cref="KscDelay.Unroutable"/>
        /// when nothing in the roster carries that id - which is the honest answer
        /// for an origin the game no longer has, and the only case that should ever
        /// reach the silence deadline.
        /// </returns>
        internal static KscDelay Resolve<TVessel>(
            string? vesselId,
            IEnumerable<TVessel>? roster,
            Func<TVessel, string?> idOf,
            Func<TVessel, KscDelay> measure)
        {
            if (string.IsNullOrEmpty(vesselId) || roster == null)
            {
                return KscDelay.Unroutable;
            }

            foreach (var candidate in roster)
            {
                // An entry with no readable id never matches, including against an
                // empty id: two things nobody can name are not the same thing.
                var id = idOf(candidate);
                if (!string.IsNullOrEmpty(id) && string.Equals(id, vesselId, StringComparison.Ordinal))
                {
                    return measure(candidate);
                }
            }

            return KscDelay.Unroutable;
        }
    }
}
