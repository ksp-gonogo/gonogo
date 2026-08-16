using Sitrep.Host.Comms;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// The one and only way a currency event's delay is computed: the one-way
    /// light-time of a live CommNet control path whose last hop is home.
    ///
    /// <para>There used to be a straight-line arm here, subject position to
    /// KSC position, divided by c, used whenever no route existed. It was
    /// wrong in a way that mattered: a chord through the planet a craft is
    /// hiding behind is not a signal path, so it quoted a confident delay for
    /// a craft nothing could reach, and science from the far side of the
    /// system was credited as though it had arrived. There is no second way to
    /// compute a delay. No route home is <see cref="KscDelay.Unroutable"/>,
    /// which the caller must queue Blocked rather than treat as zero.</para>
    /// </summary>
    internal static class KscLightTimeMath
    {
        /// <summary>
        /// Wraps an already-routed one-way light-time, or reports the absence
        /// of one. <paramref name="routedOneWaySeconds"/> is null exactly when
        /// no control path reaches home.
        /// </summary>
        internal static KscDelay Resolve(double? routedOneWaySeconds, SignalDelayConfig config)
        {
            if (config == null || !config.Enabled)
            {
                // Delay switched off is a GENUINE zero, not an absence: the
                // player asked for instant books.
                return config == null ? KscDelay.Unroutable : KscDelay.Instant;
            }

            if (config.LightSpeedScale <= 0.0)
            {
                return KscDelay.Unroutable;
            }

            if (!routedOneWaySeconds.HasValue)
            {
                return KscDelay.Unroutable;
            }

            var seconds = routedOneWaySeconds.Value;
            if (double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0.0)
            {
                return KscDelay.Unroutable;
            }

            return KscDelay.Routed(seconds);
        }
    }
}
