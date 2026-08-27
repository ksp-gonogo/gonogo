using Sitrep.Core;
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
        /// <summary>
        /// How long an unroutable event waits before the books are reconciled
        /// anyway, when no config says otherwise. One stock game day.
        ///
        /// <para>The consensus this subsystem was built from writes the number as
        /// 86,400 and the prose beside it as "a day", which cannot both be true:
        /// 86,400 s is a day on a real-scale homeworld, and four of them on a
        /// stock one. <see cref="GameDayDefaults"/> exists because three separate
        /// policy defaults had made that same substitution. The intent was right
        /// and the literal was habit, so the constant wins and the doc is
        /// corrected, not the other way round.</para>
        ///
        /// <para>It stays a stock CONSTANT rather than a live read of the
        /// homeworld's rotation, which is what a real-scale install would want.
        /// A shorter deadline is a more forgiving policy, not a wrong
        /// measurement; <c>SilenceDeclarationSeconds</c> is already an authored
        /// knob a player can set, and a live-derived seed would have to lose to
        /// an authored value, which is wiring nothing here can test. Above all,
        /// only an origin the roster cannot produce reaches this number at all,
        /// so it governs craft nothing can reach and nothing else.</para>
        /// </summary>
        internal const double DefaultSilenceDeclarationSeconds =
            GameDayDefaults.StockDaySeconds;

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
