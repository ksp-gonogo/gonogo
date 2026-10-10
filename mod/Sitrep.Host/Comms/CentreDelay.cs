using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The <c>comms.delay</c> one command centre is sent: the light-time of the
    /// active craft's path it is sent on <c>comms.path</c>.
    ///
    /// <para>At a centre the game routes the craft's samples to, that path is
    /// the game's route and the figure is the delay the samples arrive by.
    /// Where the game states no route the plan's path is the only belief the
    /// centre has to state, so that is the honest fallback.</para>
    /// </summary>
    public static class CentreDelay
    {
        /// <summary>
        /// The light-time of <paramref name="path"/>, or none where the centre
        /// believes there is no path, which a zero would misstate as no distance.
        /// </summary>
        /// <param name="path">The path the centre is sent for the active craft.</param>
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
