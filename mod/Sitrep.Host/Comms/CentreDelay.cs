using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The <c>comms.delay</c> one command centre is sent: the light-time of the
    /// active craft's path as that centre believes it to stand, which is the
    /// path it is sent on <c>comms.path</c>.
    ///
    /// <para>The delay the engine times deliveries by is not this. That one is
    /// measured over the game's own links, because it decides when light that
    /// was really sent really lands. This is what a centre can know of it.</para>
    /// </summary>
    public static class CentreDelay
    {
        /// <summary>
        /// The light-time of <paramref name="path"/>, or none where the centre
        /// believes there is no path, which a zero would misstate as no distance.
        /// </summary>
        /// <param name="path">The centre's own path for the active craft.</param>
        /// <param name="lightFactor">What a real light time is multiplied by, greater than zero: see <see cref="DeliveryInputs.LightFactor"/>.</param>
        /// <param name="source">The craft the path is from, or <c>"game"</c>.</param>
        public static CommsDelay Over(CommsPath path, double lightFactor, string source) =>
            SignalDelay.Compute(
                new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 / lightFactor },
                path,
                source);

        /// <summary>The zero that is applied, not measured: delay is switched off, or the save has no comms network to cross.</summary>
        public static CommsDelay NotMeasured(bool networkModelled, string source) =>
            SignalDelay.Compute(
                new SignalDelayConfig { Enabled = false, CutForNoCommsModel = !networkModelled },
                null,
                source);
    }
}
