using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Stock CommNet's own answer to "how degraded is this link": the model
    /// <see cref="CommNetBackend.DegradeModel"/> hands back.
    ///
    /// <para><b>The grading, and what it is made of.</b> Stock's
    /// <c>CommNetVessel.SignalStrength</c> is a RANGE fraction: how much of the
    /// antenna pair's range curve the link has left, with stock's plasma-blackout
    /// multiplier already folded in. That is a genuine quality curve under this
    /// backend, so the rating is one minus it, and a link the game reports as
    /// disconnected rates 1 outright rather than being read off a strength field
    /// that means nothing once there is no link to measure.</para>
    ///
    /// <para><b>Why the same arithmetic is not shared with the RealAntennas
    /// backend.</b> It looks identical and it is not the same rule: RA fills the
    /// same field with a rate-ladder headroom fraction instead, so the two
    /// produce different curves from the same expression. Sharing the code would
    /// re-create exactly the ambiguity <c>comms.degrade</c> exists to remove, and
    /// the rating would arrive under one name for two rules. Each backend
    /// declares its own, and the name travels with the number.</para>
    ///
    /// <para>Pure and KSP-free: it is handed the reading the backend already
    /// took, so the rule is exercised headlessly.</para>
    /// </summary>
    internal static class CommNetDegrade
    {
        internal const string ModelId = "commnet-range-fraction";

        internal const string ModelName = "Stock CommNet (antenna range fraction)";

        /// <summary>
        /// The rating for one tick's link reading, or
        /// <see cref="CommsDegradeModels.Unknown"/> when there was nothing to
        /// read: no craft, not in flight, or a comms graph that was not safe to
        /// touch.
        ///
        /// <para>Unknown rather than 1 in that case, and the distinction is the
        /// point: a craft whose link the game says is down IS fully degraded,
        /// while a tick where nothing could be read says nothing about the link
        /// at all. Rating the second as unusable would black a video feed out
        /// during a scene settle.</para>
        /// </summary>
        internal static ICommsDegradeModel From(CommsLinkState? state)
        {
            if (state == null)
            {
                return CommsDegradeModels.Unknown;
            }
            var link = state.Value;
            return new RatedDegradeModel(
                ModelId,
                ModelName,
                link.Connected ? 1.0 - link.SignalStrength : 1.0);
        }
    }
}
