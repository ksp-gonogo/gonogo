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

        /// <summary>The instant the chunk is due, or positive infinity for one held: see <see cref="HeldSinceUt"/>.</summary>
        public double RevealUt { get; }

        /// <summary>
        /// For science earned with no route home, the instant of its last
        /// increment, which home has to hear from the craft at or after for it to
        /// land; null for a chunk due at <see cref="RevealUt"/>.
        /// </summary>
        public double? HeldSinceUt { get; }

        public AggregatedScienceChunk(string vesselId, double amount, double revealUt, double? heldSinceUt = null)
        {
            VesselId = vesselId;
            Amount = amount;
            RevealUt = heldSinceUt == null ? revealUt : double.PositiveInfinity;
            HeldSinceUt = heldSinceUt;
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
            public string VesselId = "";
            public double AccumulatedAmount;
            public double WindowStartUt;
            public double LatestUt;
            public double LatestLightTimeSeconds;

            /// <summary>Whether the window holds science earned with no route home.</summary>
            public bool Held;
        }

        /// <summary>
        /// The open windows, by vessel and by whether they are held: science a
        /// craft earns with a route home and science it earns without one never
        /// share a chunk.
        /// </summary>
        private readonly Dictionary<(string VesselId, bool Held), Window> _windows = new Dictionary<(string, bool), Window>();

        /// <summary>
        /// Records one increment for a vessel. Returns the chunk this call
        /// just flushed (cadence elapsed or threshold crossed), or null if
        /// the increment was merely accumulated.
        ///
        /// RevealUt anchors to the UT of the last increment in the window
        /// (this one, since a flush always happens on the call that
        /// triggers it), not the flush-check time - the credit is "earned"
        /// as of the last real activity, and signal delay is captured from
        /// that same moment. This is the class's answer to "science smears
        /// across arrival": a vessel travelling Mun -> Kerbin during one
        /// window reveals with the signal delay of wherever it was on the
        /// increment that closed the window, and the next window (starting
        /// fresh, closer to Kerbin) reveals sooner - coarser than
        /// per-increment smearing, but the same effect at chunk
        /// granularity.
        /// </summary>
        /// <param name="lightTimeSeconds">The signal delay the increment waits, or null for one earned with no route home, which is held until home hears from the craft.</param>
        public AggregatedScienceChunk? Accept(string vesselId, double increment, double nowUt, double? lightTimeSeconds)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                throw new ArgumentException("vesselId must not be null or empty", nameof(vesselId));
            }

            var key = (vesselId, lightTimeSeconds == null);
            if (!_windows.TryGetValue(key, out var window))
            {
                window = new Window { VesselId = vesselId, WindowStartUt = nowUt, Held = lightTimeSeconds == null };
                _windows[key] = window;
            }

            window.AccumulatedAmount += increment;
            window.LatestUt = nowUt;
            window.LatestLightTimeSeconds = lightTimeSeconds ?? 0.0;

            var cadenceElapsed = nowUt - window.WindowStartUt >= FlushCadenceSeconds;
            var thresholdCrossed = window.AccumulatedAmount >= FlushThresholdScience;

            if (cadenceElapsed || thresholdCrossed)
            {
                return Flush(key, window);
            }

            return null;
        }

        /// <summary>
        /// Multiplies the signal delay every open window will reveal with by
        /// <paramref name="factor"/>, for a delay that has just been shortened or
        /// switched off. Switched off, a factor of 0, a held window is due at
        /// once like the rest.
        /// </summary>
        public void ScaleLightTimes(double factor)
        {
            foreach (var window in _windows.Values)
            {
                window.LatestLightTimeSeconds *= Math.Max(0.0, factor);
                if (factor <= 0.0)
                {
                    window.Held = false;
                }
            }
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

            foreach (var key in new List<(string, bool)>(_windows.Keys))
            {
                var window = _windows[key];
                if (nowUt - window.WindowStartUt >= FlushCadenceSeconds)
                {
                    flushed.Add(Flush(key, window));
                }
            }

            return flushed;
        }

        private AggregatedScienceChunk Flush((string, bool) key, Window window)
        {
            var chunk = new AggregatedScienceChunk(
                window.VesselId,
                window.AccumulatedAmount,
                window.LatestUt + window.LatestLightTimeSeconds,
                window.Held ? window.LatestUt : (double?)null);

            _windows.Remove(key);

            return chunk;
        }
    }
}
