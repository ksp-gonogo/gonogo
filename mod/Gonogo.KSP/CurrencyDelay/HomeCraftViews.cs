using System;
using Sitrep.Host.Comms;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// Home's view of each craft, for the career's books to read from the game's
    /// thread. Bound by the uplink that judges at home; unbound, every craft
    /// reads as one home has no word of, so a held change stays held.
    /// </summary>
    public static class HomeCraftViews
    {
        private static Func<string, HomeCraftView?>? _viewOf;

        public static void Bind(Func<string, HomeCraftView?> viewOf) => _viewOf = viewOf;

        public static void Unbind() => _viewOf = null;

        /// <summary>Home's view of the craft, by bare guid, or null when home has no word of it or nothing is bound.</summary>
        public static HomeCraftView? Of(string vesselId) => _viewOf?.Invoke(vesselId);
    }
}
