using Sitrep.Host.Comms;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// The single place a <see cref="KscDelay"/> becomes a number of seconds.
    ///
    /// <para><b>Why this exists rather than call sites doing the arithmetic.</b>
    /// The feature's off switch, <c>SignalDelayConfig.Enabled</c>, used to be
    /// consulted only inside <c>KscLightTimeMath.Resolve</c>, i.e. only where a
    /// delay is COMPUTED. Every code path that produced a
    /// <see cref="KscDelay.Unroutable"/> literal instead of calling Resolve
    /// therefore skipped the check, and there were several: a null vessel, a
    /// throwing route read, a vessel absent from <c>FlightGlobals</c>, and the
    /// ordinary science path, whose origin is a ProtoVessel and so never has a
    /// live vessel to resolve. With signal delay switched OFF, all of them still
    /// withheld the credit for a full Kerbin day.</para>
    ///
    /// <para>So the gate moved to where a delay is CONSUMED. A player who turned
    /// the feature off gets stock behaviour, whatever the routing did or did not
    /// find.</para>
    /// </summary>
    internal static class KscDelayPolicy
    {
        internal const double DefaultSilenceDeclarationSeconds = 86_400.0;

        /// <summary>
        /// Whether delay applies at all. A null config is the pre-configure
        /// state, which <c>CommsCoreUplink</c> initialises to
        /// <c>SignalDelayConfig.Off()</c>; treating it as off matches that.
        /// </summary>
        private static bool Enabled(SignalDelayConfig config) => config != null && config.Enabled;

        private static double SilenceDeclarationSeconds(SignalDelayConfig config) =>
            config != null ? config.SilenceDeclarationSeconds : DefaultSilenceDeclarationSeconds;

        /// <summary>
        /// Seconds to add to an event's UT. Zero whenever the feature is off,
        /// including for an unroutable event: "no route" only matters if delay
        /// is being modelled at all.
        /// </summary>
        internal static double DelaySeconds(KscDelay delay, SignalDelayConfig config)
        {
            if (!Enabled(config))
            {
                return 0.0;
            }
            return delay.IsUnroutable ? SilenceDeclarationSeconds(config) : delay.Seconds;
        }

        /// <summary>The UT an event becomes visible in the books.</summary>
        internal static double RevealUt(KscDelay delay, double eventUt, SignalDelayConfig config) =>
            eventUt + DelaySeconds(delay, config);
    }
}
