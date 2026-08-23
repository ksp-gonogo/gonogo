using System;

namespace Sitrep.Contract
{
    /// <summary>Why no delayed state could be established.</summary>
    public enum DelayedStateRefusal
    {
        /// <summary>None. Zero so a default-constructed value does not read as a
        /// refusal that never happened.</summary>
        None = 0,

        /// <summary>
        /// Nothing has arrived at this vantage yet. The craft may be perfectly
        /// healthy: at a distant vantage early in a mission, no light has carried
        /// anything about it, and that is a fact about the observer.
        /// </summary>
        NothingArrived = 1,

        /// <summary>
        /// Something arrived, but the archive no longer holds the sample that was
        /// current at the requested instant, so the honest answer is silence rather
        /// than the nearest sample.
        /// </summary>
        BeyondRetainedHistory = 2,

        /// <summary>The vantage's delay is unknown, so the view instant cannot be
        /// established and neither can what the vantage may see.</summary>
        DelayUnknown = 3,
    }

    /// <summary>
    /// A vessel state that a particular vantage is entitled to know about, and the
    /// instant it was actually true.
    ///
    /// <para><b>This type exists so that a propagation cannot accidentally start from
    /// the game's live truth.</b> The propagation seam resolves its target from the
    /// running game (<c>PropagationTarget</c> carries an identity, never a state), so
    /// anything solved through it answers for NOW, which is ahead of everything the
    /// operator can see. At thirty light-minutes that difference is the whole
    /// mission: it would report a craft as healthy four minutes after it stopped
    /// existing.</para>
    ///
    /// <para>The load-bearing field is <see cref="ObservedAtUt"/>, and it is the
    /// SAMPLE'S OWN instant, never a freshly computed <c>now - delay</c>. The two are
    /// usually close and differ silently when they differ: a slow-changing channel
    /// hands back a sample from well before the delay window's edge, and stamping it
    /// with the window edge asserts the craft was in that state later than it was.
    /// Everything downstream is then confidently wrong with nothing to notice.</para>
    /// </summary>
    public readonly struct DelayedObservation
    {
        private DelayedObservation(
            bool established,
            StateVector state,
            int centreBodyIndex,
            double observedAtUt,
            double viewUt,
            DelayedStateRefusal refusal,
            string? reason)
        {
            Established = established;
            State = state;
            CentreBodyIndex = centreBodyIndex;
            ObservedAtUt = observedAtUt;
            ViewUt = viewUt;
            Refusal = refusal;
            Reason = reason;
        }

        public bool Established { get; }

        /// <summary>Position and velocity relative to <see cref="CentreBodyIndex"/>.</summary>
        public StateVector State { get; }

        public int CentreBodyIndex { get; }

        /// <summary>
        /// When this state was TRUE, taken from the sample itself. A propagation
        /// seeded here must integrate from this instant, not from
        /// <see cref="ViewUt"/>.
        /// </summary>
        public double ObservedAtUt { get; }

        /// <summary>
        /// The instant the vantage is currently seeing. Always at or after
        /// <see cref="ObservedAtUt"/>: the gap is how stale the freshest arrived
        /// news is, which is a real thing an operator wants shown.
        /// </summary>
        public double ViewUt { get; }

        /// <summary>How long this state has been the newest thing the vantage has.</summary>
        public double AgeSeconds => ViewUt - ObservedAtUt;

        public DelayedStateRefusal Refusal { get; }
        public string? Reason { get; }

        public static DelayedObservation Refused(DelayedStateRefusal refusal, string reason) =>
            new DelayedObservation(false, default, -1, double.NaN, double.NaN, refusal, reason);

        /// <summary>
        /// Establish an observation. Refuses rather than constructing one when the
        /// sample is dated AFTER the view instant, because that combination cannot
        /// arise from light that has arrived and would be a future leak wearing the
        /// shape of an observation.
        /// </summary>
        public static DelayedObservation At(
            StateVector state, int centreBodyIndex, double observedAtUt, double viewUt)
        {
            if (double.IsNaN(observedAtUt) || double.IsNaN(viewUt))
            {
                return Refused(
                    DelayedStateRefusal.DelayUnknown,
                    "The observation or view instant is not a number, so nothing can be said about "
                        + "what this vantage may see.");
            }
            if (observedAtUt > viewUt)
            {
                return Refused(
                    DelayedStateRefusal.DelayUnknown,
                    "The sample is dated after the vantage's view instant, which no arrived light "
                        + "can produce. Refusing rather than reporting a state from the future.");
            }
            return new DelayedObservation(
                true, state, centreBodyIndex, observedAtUt, viewUt, DelayedStateRefusal.None, null);
        }
    }
}
