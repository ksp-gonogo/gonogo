using System;

namespace Sitrep.Host.Propulsion
{
    /// <summary>
    /// Watches a vessel's thrust over time and LATCHES the two instants that
    /// describe it, so a consumer never has to have seen the frame the change
    /// happened on.
    ///
    /// <para><b>Why a latch and not an edge.</b> Every vessel channel is
    /// declared <c>Delivery.LossyLatest</c> and the whole snapshot is gated at
    /// <c>SampleIntervalUt</c>, so intermediate values are dropped by design.
    /// An edge ("thrust just ended") is a one-shot that a lossy transport is
    /// entitled to eat, and a consumer that missed it cannot tell that from
    /// nothing having happened. A latched instant is idempotent: it is still
    /// sitting there on the next frame that does arrive, and every frame
    /// carries the same answer until it changes again.</para>
    ///
    /// <para><b>Why the commanded throttle cannot do this job.</b>
    /// <c>vessel.control.throttle</c> is where the pilot left the lever. It
    /// stays at full through a flameout, a dry tank, and a stage that was never
    /// lit, and it moves for reasons that have nothing to do with whether
    /// anything is producing thrust. Measured thrust is the only reading that
    /// moves when the thing it describes happens.</para>
    ///
    /// <para><b>Thrust is only measurable on a loaded, unpacked craft.</b> An
    /// on-rails vessel has no parts to read and reports no thrust, which is a
    /// fact about the simulation rather than about the engines. Observing
    /// through that would latch a cessation the moment a burning craft was
    /// switched away from, so an unmeasurable tick HOLDS both latches instead
    /// of moving them.</para>
    /// </summary>
    public sealed class ThrustObserver
    {
        /// <summary>
        /// Thrust at or below this counts as none, kN. Engines settle to a
        /// residual rather than an exact zero, and a threshold picked once here
        /// is one decision instead of one per consumer.
        /// </summary>
        public const double ThrustEpsilonKn = 0.001;

        private string _subject = "";
        private bool _underThrust;

        /// <summary>
        /// UT the CURRENT continuous period of thrust began, or null when the
        /// craft is not under thrust as of the last measurable observation.
        /// An OBSERVATION INSTANT: it says when something was seen to be true,
        /// so the only duration it may take part in is one measured against the
        /// reader's own view clock. Subtracting it from a plan's instants is
        /// type-legal and means nothing.
        /// </summary>
        public double? ThrustStartedUt { get; private set; }

        /// <summary>
        /// UT the most recent period of thrust ENDED, or null when no period of
        /// thrust has ever been observed to end for this craft. Same
        /// observation-instant reading as <see cref="ThrustStartedUt"/>.
        ///
        /// <para>Its presence alongside a null <see cref="ThrustStartedUt"/> is
        /// the whole point: together they say "the engines ran and have
        /// stopped", which neither a thrust reading nor a throttle reading can
        /// say on its own.</para>
        /// </summary>
        public double? LastThrustEndUt { get; private set; }

        /// <summary>
        /// Fold one observation in.
        /// </summary>
        /// <param name="subject">
        /// Which craft this reading is of. A change resets both latches: the
        /// previous craft's engines say nothing about this one's, and carrying
        /// a latch across a vessel switch would report the wrong craft's burn.
        /// </param>
        /// <param name="ut">The instant the reading was taken.</param>
        /// <param name="thrustKn">Measured thrust, kN.</param>
        /// <param name="measurable">
        /// Whether thrust was readable at all this tick (a loaded, unpacked
        /// craft). False HOLDS both latches rather than reading the absence as
        /// a cessation.
        /// </param>
        public void Observe(string subject, double ut, double thrustKn, bool measurable)
        {
            if (subject != _subject)
            {
                _subject = subject;
                _underThrust = false;
                ThrustStartedUt = null;
                LastThrustEndUt = null;
            }

            if (!measurable || double.IsNaN(thrustKn) || double.IsInfinity(thrustKn))
            {
                return;
            }

            var thrusting = thrustKn > ThrustEpsilonKn;
            if (thrusting == _underThrust)
            {
                return;
            }

            _underThrust = thrusting;
            if (thrusting)
            {
                ThrustStartedUt = ut;
            }
            else
            {
                ThrustStartedUt = null;
                LastThrustEndUt = ut;
            }
        }
    }
}
