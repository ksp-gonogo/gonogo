using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// RealAntennas' own answer to "how degraded is this link": the model
    /// <see cref="RaCommsBackend.DegradeModel"/> hands back.
    ///
    /// <para><b>A different quantity from the stock backend's, under the same
    /// field.</b> RA fills <c>CommNetVessel.SignalStrength</c> with how much of
    /// the negotiated data-rate ladder the link still has spare, not with how far
    /// through an antenna range curve it sits, and it applies none of stock's
    /// plasma-blackout multiplier. So the rating is one minus that headroom, and
    /// it is a rate-ladder grading rather than a range grading. Both facts reach
    /// a consumer through <see cref="ModelId"/>, which is why this rule is
    /// declared here rather than shared with the stock one that happens to
    /// compute the same expression.</para>
    ///
    /// <para><b>Why not the dB link budget.</b> This Uplink already re-derives a
    /// margin in decibels and publishes it on its own channel, and that is the
    /// richer figure. It is deliberately not what this grades on: the margin is
    /// a best-effort re-derivation of RA's public formulas rather than RA's own
    /// verdict, and a cross-backend scale should be built from what the game
    /// itself decided. A consumer that wants the physics reads the margin
    /// channel; this is the one number that means the same KIND of thing on
    /// every install.</para>
    ///
    /// <para>Pure and KSP-free: it is handed the reading the backend already
    /// took, so the rule is exercised headlessly.</para>
    /// </summary>
    internal static class RaDegrade
    {
        internal const string ModelId = "realantennas-rate-headroom";

        internal const string ModelName = "RealAntennas (data-rate ladder headroom)";

        /// <summary>
        /// The rating for one tick's link reading, or
        /// <see cref="CommsDegradeModels.Unknown"/> when there was nothing to
        /// read.
        ///
        /// <para>A link RA reports as down rates 1 rather than being read off a
        /// headroom fraction that has no meaning once no rate closes at all. A
        /// tick with nothing to read stays UNRATED, because it is a statement
        /// about the read and not about the link.</para>
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
