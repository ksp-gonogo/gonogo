using System;

namespace Sitrep.Contract
{
    /// <summary>Why no delayed state could be established for a vantage.</summary>
    /// <category>Comms</category>
    public enum DelayedStateRefusal
    {
        /// <summary>Not refused. Zero, so a default-constructed value is not a
        /// refusal.</summary>
        None = 0,

        /// <summary>
        /// Nothing has arrived at this vantage yet. The craft may be perfectly
        /// healthy: at a distant vantage early in a mission, no light has carried
        /// anything about it, and that is a fact about the observer.
        /// </summary>
        NothingArrived = 1,

        /// <summary>
        /// Something arrived, but no retained sample can serve the requested
        /// instant, so the result is a refusal rather than the nearest sample.
        /// <internal>
        /// DelayedStateReader also uses this when the arrived sample converts to
        /// no state a propagation could be seeded from.
        /// </internal>
        /// </summary>
        BeyondRetainedHistory = 2,

        /// <summary>The vantage's delay is unknown (or a sample is dated after
        /// the view instant), so what the vantage may see cannot be
        /// established.</summary>
        DelayUnknown = 3,
    }

    /// <summary>
    /// The newest vessel state that has reached a particular vantage, and the
    /// instant it was true; or, when <see cref="Established"/> is false, why
    /// there is none.
    ///
    /// <para>Seed a delay-aware propagation from this rather than from
    /// <see cref="PropagationTarget"/>, which carries an identity rather than a
    /// state and so solves from the game's live truth, ahead of everything the
    /// operator can see. At thirty light-minutes that difference would report a
    /// craft as healthy minutes after it stopped existing.</para>
    ///
    /// <para><see cref="ObservedAtUt"/> is the sample's own instant, never a
    /// computed <c>now - delay</c>. A slow-changing channel's newest sample can
    /// date from well before the delay window's edge, and stamping it with the
    /// edge would assert the craft held that state later than it did.</para>
    /// </summary>
    /// <category>Comms</category>
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

        /// <summary>True when a state was established; false on a refusal, when
        /// <see cref="Refusal"/> and <see cref="Reason"/> say why and the other
        /// fields carry no data.</summary>
        public bool Established { get; }

        /// <summary>Position and velocity relative to <see
        /// cref="CentreBodyIndex"/>. The default value on a refusal.</summary>
        public StateVector State { get; }

        /// <summary>The <c>system.bodies</c> index of the body <see cref="State"/>
        /// is expressed about; -1 on a refusal.</summary>
        public int CentreBodyIndex { get; }

        /// <summary>
        /// When this state was true (UT seconds), taken from the sample itself. A
        /// propagation seeded here must integrate from this instant, not from
        /// <see cref="ViewUt"/>. NaN on a refusal.
        /// </summary>
        public double ObservedAtUt { get; }

        /// <summary>
        /// The instant the vantage is currently seeing (UT seconds). Always at or
        /// after <see cref="ObservedAtUt"/>: the gap is how long the newest
        /// arrived state has been held, which an operator wants shown. NaN on a
        /// refusal.
        /// </summary>
        public double ViewUt { get; }

        /// <summary>How long, in seconds, this state has been the newest thing the
        /// vantage has: <see cref="ViewUt"/> minus <see cref="ObservedAtUt"/>.
        /// NaN on a refusal.</summary>
        public double AgeSeconds => ViewUt - ObservedAtUt;

        /// <summary>Why no state was established; <see cref="DelayedStateRefusal.None"/>
        /// when <see cref="Established"/> is true.</summary>
        public DelayedStateRefusal Refusal { get; }

        /// <summary>A human-readable explanation of the refusal; null when
        /// <see cref="Established"/> is true.</summary>
        public string? Reason { get; }

        /// <summary>A refusal: no state, with the reason it could not be
        /// established.</summary>
        /// <param name="refusal">Which kind of refusal this is.</param>
        /// <param name="reason">A human-readable explanation.</param>
        /// <returns>An observation with <see cref="Established"/> false, <see
        /// cref="CentreBodyIndex"/> -1 and NaN instants.</returns>
        public static DelayedObservation Refused(DelayedStateRefusal refusal, string reason) =>
            new DelayedObservation(false, default, -1, double.NaN, double.NaN, refusal, reason);

        /// <summary>
        /// Establish an observation. Returns a
        /// <see cref="DelayedStateRefusal.DelayUnknown"/> refusal instead when
        /// either instant is NaN, or when the sample is dated after the view
        /// instant, which no arrived light can produce.
        /// </summary>
        /// <param name="state">The state, relative to <paramref name="centreBodyIndex"/>.</param>
        /// <param name="centreBodyIndex">The <c>system.bodies</c> index of the body the state is about.</param>
        /// <param name="observedAtUt">When the state was true, from the sample itself.</param>
        /// <param name="viewUt">The instant the vantage is currently seeing.</param>
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
