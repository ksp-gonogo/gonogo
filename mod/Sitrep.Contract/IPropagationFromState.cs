namespace Sitrep.Contract
{
    /// <summary>
    /// The path followed from a state the caller supplies, rather than from the one the
    /// game holds now. An elected <see cref="IPropagationProvider"/> implements this
    /// beside it to answer from a given state with its own physics. When the elected
    /// provider does not, Gonogo answers an accurate ask itself only while no integrating
    /// provider is elected, and an analytic ask with its two-body solver.
    /// <internal>
    /// Kept apart from IPropagationProvider so that a provider built before it existed
    /// still loads and keeps every other answer.
    /// </internal>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface IPropagationFromState
    {
        /// <summary>
        /// The path from <paramref name="seed"/>, sampled up to <paramref name="toUt"/>.
        ///
        /// <para>Under <see cref="PropagationCertification.Unbounded"/> the analytic
        /// answer will do, and a provider that integrates answers with its conic.
        /// Under any other value, <see cref="PropagationCertification.Unspecified"/>
        /// included, the caller needs the accurate answer: a provider that integrates
        /// integrates, and refuses rather than falling back to a conic, because the two
        /// plot the same way. A closed-form provider answers both the same.</para>
        ///
        /// <para>Read <see cref="PropagatedPath.ReachedUt"/> for how far the answer
        /// goes, which can be short of <paramref name="toUt"/>, and
        /// <see cref="PropagatedPath.Kind"/> for what it is. Deterministic, as
        /// <see cref="IPropagationProvider.Solve"/> is. May take far longer than a
        /// solve, so never call it on the game thread.</para>
        /// </summary>
        /// <param name="seed">The state to start from.</param>
        /// <param name="toUt">Where to stop, in UT seconds. At or before the seed's instant is refused.</param>
        /// <param name="maxPoints">The most points to return. Zero takes <see cref="PropagatedPath.DefaultPoints"/>.</param>
        /// <param name="certification">Whether the analytic answer will do.</param>
        /// <returns>The path, or why there is none. Never throws for an unanswerable question.</returns>
        PropagatedPath PropagateFromState(
            PropagationSeed seed,
            double toUt,
            int maxPoints,
            PropagationCertification certification);
    }
}
