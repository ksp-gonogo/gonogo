using System;
using Sitrep.Host.Comms;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// Static pointer to the CURRENT save's <see cref="SilenceTracker"/>,
    /// bound by <see cref="SilenceTrackerScenario"/> on <c>OnAwake</c> and
    /// cleared on <c>OnDestroy</c>. Same discipline as
    /// <c>CurrencyDelay.DelayedScienceSink</c>: the pointer is rebound, never
    /// the state itself, so a quickload/revert swaps in the freshly-loaded
    /// tracker rather than letting <see cref="FleetSilenceChannels"/> (which
    /// registers ONCE per process, not per scene/save load) carry stale
    /// silence state across a reload.
    /// </summary>
    public static class SilenceTrackerSink
    {
        private static SilenceTracker? _current;

        public static void Bind(SilenceTracker tracker) => _current = tracker ?? throw new ArgumentNullException(nameof(tracker));

        public static void Unbind() => _current = null;

        /// <summary>The live tracker for the current save, or null when no scenario is active (e.g. main menu).</summary>
        public static SilenceTracker? Current => _current;
    }
}
