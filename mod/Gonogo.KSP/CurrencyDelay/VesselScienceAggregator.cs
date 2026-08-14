using System;
using System.Collections.Generic;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// One coalesced science credit ready for the pending-credit ledger:
    /// a vessel's accumulated increments over one flush window, tagged with
    /// the reveal-UT it should surface at KSC.
    /// </summary>
    public readonly struct AggregatedScienceChunk
    {
        public string VesselId { get; }
        public double Amount { get; }
        public double RevealUt { get; }

        public AggregatedScienceChunk(string vesselId, double amount, double revealUt)
        {
            VesselId = vesselId;
            Amount = amount;
            RevealUt = revealUt;
        }
    }

    /// <summary>
    /// Coalesces a continuous science source's fine-grained per-tick increments into a small number
    /// of delayed credits per vessel.
    ///
    /// A source that credits science incrementally (e.g. buffered transmission) can fire tens of
    /// thousands of times per session, almost all sub-0.01 science. A delayed credit per call is
    /// infeasible - both for the ledger's row count and for the reveal UI - so increments are
    /// accumulated per vessel and flushed into a chunk when either ~2.5s of game-UT has passed
    /// since the vessel's first un-flushed increment, or the accumulated amount crosses a small
    /// threshold. Two vessels transmitting concurrently get independent windows; there is no
    /// cross-vessel pooling, which is exactly the vessel-attribution loss this class exists to
    /// avoid when the upstream source pools its own buffer globally.
    ///
    /// Pure logic: no GameEvents, no Harmony, no live KSP calls, no KSP types at all.
    /// <see cref="DelayedScienceSink"/> feeds increments in; the owning scenario's per-frame tick
    /// calls <see cref="Drain"/> every frame so a vessel that stops transmitting mid-window still
    /// gets its final partial chunk revealed.
    /// </summary>
    public sealed class VesselScienceAggregator
    {
        /// <summary>
        /// Game-UT seconds a vessel's window may stay open before it is
        /// force-flushed regardless of accumulated amount. Chosen to mirror a
        /// typical buffered-science flush cadence (~2.5 real seconds between
        /// pooled AddScience calls), so a transmitting vessel reveals credits
        /// at roughly the same real-world rate the source itself would have
        /// credited them, just per-vessel instead of pooled.
        /// </summary>
        internal const double FlushCadenceSeconds = 2.5;

        /// <summary>
        /// Accumulated science (in a single vessel's window) that forces an
        /// immediate flush even if the cadence hasn't elapsed. Matches a
        /// typical upstream buffer threshold (~0.1 science) so a vessel
        /// transmitting a large, fast burst still reveals promptly instead of
        /// waiting out the full cadence.
        /// </summary>
        internal const double FlushThresholdScience = 0.1;

        private sealed class Window
        {
            public double AccumulatedAmount;
            public double WindowStartUt;
            public double LatestUt;
            public double LatestLightTimeSeconds;
        }

        private readonly Dictionary<string, Window> _windows = new Dictionary<string, Window>();

        /// <summary>
        /// Records one increment for a vessel. Returns the chunk this call
        /// just flushed (cadence elapsed or threshold crossed), or null if
        /// the increment was merely accumulated.
        ///
        /// RevealUt anchors to the UT of the LAST increment in the window
        /// (this one, since a flush always happens on the call that
        /// triggers it), not the flush-check time - the credit is "earned"
        /// as of the last real activity, and light-time is captured from
        /// that same moment. This is the class's answer to "science smears
        /// across arrival": a vessel travelling Mun -> Kerbin during one
        /// window reveals with the light-time of wherever it was on the
        /// increment that closed the window, and the NEXT window (starting
        /// fresh, closer to Kerbin) reveals sooner - coarser than
        /// per-increment smearing, but the same effect at chunk
        /// granularity.
        /// </summary>
        public AggregatedScienceChunk? Accept(string vesselId, double increment, double nowUt, double lightTimeSeconds)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                throw new ArgumentException("vesselId must not be null or empty", nameof(vesselId));
            }

            if (!_windows.TryGetValue(vesselId, out var window))
            {
                window = new Window { WindowStartUt = nowUt };
                _windows[vesselId] = window;
            }

            window.AccumulatedAmount += increment;
            window.LatestUt = nowUt;
            window.LatestLightTimeSeconds = lightTimeSeconds;

            var cadenceElapsed = nowUt - window.WindowStartUt >= FlushCadenceSeconds;
            var thresholdCrossed = window.AccumulatedAmount >= FlushThresholdScience;

            if (cadenceElapsed || thresholdCrossed)
            {
                return Flush(vesselId, window);
            }

            return null;
        }

        /// <summary>
        /// Flushes every vessel whose window has exceeded the cadence with
        /// no new increment to trigger it inline - the case a stalled or
        /// stopped vessel needs, since <see cref="Accept"/> only checks a
        /// vessel's window when that vessel actually reports an increment.
        /// Intended to be called once per frame (or per tick) from the
        /// owning ScenarioModule so a vessel's final partial chunk is never
        /// left stranded past its cadence.
        /// </summary>
        public List<AggregatedScienceChunk> Drain(double nowUt)
        {
            var flushed = new List<AggregatedScienceChunk>();

            foreach (var vesselId in new List<string>(_windows.Keys))
            {
                var window = _windows[vesselId];
                if (nowUt - window.WindowStartUt >= FlushCadenceSeconds)
                {
                    flushed.Add(Flush(vesselId, window));
                }
            }

            return flushed;
        }

        private AggregatedScienceChunk Flush(string vesselId, Window window)
        {
            var chunk = new AggregatedScienceChunk(
                vesselId,
                window.AccumulatedAmount,
                window.LatestUt + window.LatestLightTimeSeconds);

            _windows.Remove(vesselId);

            return chunk;
        }
    }
}
