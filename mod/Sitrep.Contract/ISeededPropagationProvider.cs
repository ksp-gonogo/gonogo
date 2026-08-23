namespace Sitrep.Contract
{
    /// <summary>A trajectory propagated from a supplied state, or the reason there is none.</summary>
    public readonly struct SeededTrajectory
    {
        private SeededTrajectory(bool solved, TrajectoryArc? arc, double seededAtUt, string? refusal)
        {
            Solved = solved;
            Arc = arc;
            SeededAtUt = seededAtUt;
            Refusal = refusal;
        }

        public bool Solved { get; }

        public TrajectoryArc? Arc { get; }

        /// <summary>
        /// The instant the seed state was TRUE, carried through so a consumer can
        /// say what the answer was computed from. An arc detached from this is a
        /// path with no claim about which craft, or when.
        /// </summary>
        public double SeededAtUt { get; }

        public string? Refusal { get; }

        public static SeededTrajectory Refused(string refusal) =>
            new SeededTrajectory(false, null, double.NaN, refusal);

        public static SeededTrajectory From(TrajectoryArc arc, double seededAtUt) =>
            new SeededTrajectory(true, arc, seededAtUt, null);
    }

    /// <summary>
    /// Propagates from a state a caller SUPPLIES, rather than from the one the game
    /// currently holds.
    ///
    /// <para><b>Why this exists beside <see cref="IPropagationProvider"/>.</b> That
    /// interface takes a <c>PropagationTarget</c>, which carries an identity and not
    /// a state, so it resolves the craft from the running game and answers for NOW.
    /// That is right for asking where something IS. It cannot express the question a
    /// command centre asks, which is where a craft goes GIVEN WHAT I CAN SEE, and at
    /// half an hour of light-time those are different questions with different
    /// answers.</para>
    ///
    /// <para>The seed is a <see cref="DelayedObservation"/> rather than a bare state
    /// and instant, deliberately. That type cannot be constructed with an instant
    /// after the vantage's own view, so a provider cannot be handed something from
    /// the future by a caller that computed its inputs carelessly. The alternative,
    /// two loose doubles, puts that guarantee in every call site instead of in the
    /// type.</para>
    ///
    /// <para>A provider that cannot integrate a given seed says so rather than
    /// falling back to a two-body approximation of it. A conic quietly substituted
    /// for an n-body answer is the same shape, plots the same way, and is wrong in
    /// exactly the regime the operator asked the question for.</para>
    /// </summary>
    public interface ISeededPropagationProvider
    {
        /// <summary>
        /// Whether this provider can propagate from <paramref name="seed"/> at all:
        /// a centre it has no gravity model for, or an unestablished observation,
        /// are both answered here rather than by a refusal mid-solve.
        /// </summary>
        bool CanSeedFrom(DelayedObservation seed);

        /// <summary>
        /// Propagate from <paramref name="seed"/> to <paramref name="toUt"/>.
        ///
        /// <para>Deterministic: the same seed and horizon give the same arc, with no
        /// dependence on wall clock or on what the game is doing. That is what makes
        /// a command centre's answer reproducible, and what lets a divergence between
        /// a prediction and a later observation mean something.</para>
        /// </summary>
        SeededTrajectory SolveFrom(DelayedObservation seed, double toUt, int maxPoints);
    }
}
