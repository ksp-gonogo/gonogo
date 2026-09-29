namespace Sitrep.Contract
{
    /// <summary>
    /// The result of <see cref="ISeededPropagationProvider.SolveFrom"/>: a
    /// trajectory propagated from a supplied state, or the reason there is none.
    /// Exactly one of <see cref="Arc"/> and <see cref="Refusal"/> is set.
    /// </summary>
    /// <category>Propagation and models</category>
    public readonly struct SeededTrajectory
    {
        private SeededTrajectory(bool solved, TrajectoryArc? arc, double seededAtUt, string? refusal)
        {
            Solved = solved;
            Arc = arc;
            SeededAtUt = seededAtUt;
            Refusal = refusal;
        }

        /// <summary>
        /// <c>true</c> when the provider produced a trajectory: <see cref="Arc"/> is
        /// set and <see cref="Refusal"/> is <c>null</c>. <c>false</c> when it
        /// declined, and <see cref="Refusal"/> says why.
        /// </summary>
        public bool Solved { get; }

        /// <summary>The propagated trajectory, or <c>null</c> when the solve was refused.</summary>
        public TrajectoryArc? Arc { get; }

        /// <summary>
        /// The instant the seed state was true, in UT seconds, so a consumer can say
        /// what the trajectory was computed from. An arc without it makes no claim
        /// about which craft, or when. <c>NaN</c> when the solve was refused.
        /// </summary>
        public double SeededAtUt { get; }

        /// <summary>
        /// A human-readable sentence saying why no trajectory was produced, or
        /// <c>null</c> when the solve succeeded.
        /// </summary>
        public string? Refusal { get; }

        /// <summary>A refused result carrying <paramref name="refusal"/>, with no arc and a <c>NaN</c> <see cref="SeededAtUt"/>.</summary>
        /// <param name="refusal">A human-readable sentence saying why the provider declined.</param>
        public static SeededTrajectory Refused(string refusal) =>
            new SeededTrajectory(false, null, double.NaN, refusal);

        /// <summary>A solved result.</summary>
        /// <param name="arc">The propagated trajectory.</param>
        /// <param name="seededAtUt">The UT, in seconds, at which the seed state was true.</param>
        public static SeededTrajectory From(TrajectoryArc arc, double seededAtUt) =>
            new SeededTrajectory(true, arc, seededAtUt, null);
    }

    /// <summary>
    /// Propagates from a state the caller supplies, rather than from the one the
    /// game currently holds.
    ///
    /// <para><see cref="IPropagationProvider"/> takes a <c>PropagationTarget</c>,
    /// an identity rather than a state, so it resolves the craft from the running
    /// game and describes it now. This interface describes where a craft goes
    /// given what a vantage can see, which differs once there is light-time
    /// delay.</para>
    ///
    /// <para>The seed is a <see cref="DelayedObservation"/>, which cannot be built
    /// with an instant later than the vantage's own view, so a provider is never
    /// handed a state from the future.</para>
    ///
    /// <para>A provider that cannot integrate a given seed refuses rather than
    /// falling back to a two-body approximation: a conic in place of an n-body
    /// trajectory plots the same way and is wrong in exactly the regime the
    /// question was asked for.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface ISeededPropagationProvider
    {
        /// <summary>
        /// Whether this provider can propagate from <paramref name="seed"/> at all.
        /// A centre body it has no gravity model for, or an observation that was
        /// never established, returns <c>false</c> here rather than a refusal from
        /// <see cref="SolveFrom"/>.
        /// </summary>
        /// <param name="seed">The observed state to propagate from.</param>
        bool CanSeedFrom(DelayedObservation seed);

        /// <summary>
        /// Propagates from <paramref name="seed"/> to <paramref name="toUt"/>.
        ///
        /// <para>Deterministic: the same seed and horizon give the same arc, with no
        /// dependence on wall clock or on what the game is doing. That makes a
        /// command centre's prediction reproducible, so a divergence from a later
        /// observation means something.</para>
        /// </summary>
        /// <param name="seed">The observed state; integration starts at the instant it was true, not at the vantage's view.</param>
        /// <param name="toUt">The horizon, in UT seconds. A horizon at or before the seed instant is refused.</param>
        /// <param name="maxPoints">The most sample points the returned arc may carry.</param>
        /// <returns>The trajectory, or a refusal saying why there is none.</returns>
        SeededTrajectory SolveFrom(DelayedObservation seed, double toUt, int maxPoints);
    }
}
