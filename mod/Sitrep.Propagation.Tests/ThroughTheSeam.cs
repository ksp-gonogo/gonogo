namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// Asking a provider about one bare conic, the only way there now is.
    ///
    /// <para>These tests describe a single orbit with no system around it: no body table,
    /// no station, nothing else to be relative to. That used to reach the solver through
    /// <c>KeplerProvider.Solve(OrbitElements, double)</c>, which was a public door beside
    /// the seam, and which sixteen tests across six files used. It is private now, so a
    /// conic arrives the way every other caller sends one: as a target's payload, asked
    /// for in the target's own parent frame.</para>
    ///
    /// <para>This is a readability wrapper over <see cref="IPropagationProvider"/>, not a
    /// way around it. It reaches nothing the interface does not have, which is exactly
    /// what <c>TheVanillaHasNoDoorBesideTheSeamTests</c> exists to keep true, and it is
    /// deliberately NOT called <c>Solve</c>: a name that let the old call sites compile
    /// unchanged would hide the fact that they now go somewhere else.</para>
    /// </summary>
    internal static class ThroughTheSeam
    {
        /// <summary>
        /// The body a lone conic is measured against. Which one it is does not matter here
        /// and cannot: the point is only that the target and the frame agree on a centre,
        /// which is the same invariant a caller holding nothing but elements always relied
        /// on.
        /// </summary>
        internal const int ItsOwnParent = 0;

        internal static PropagationTarget Craft(OrbitElements orbit, string id = "test-craft") =>
            PropagationTarget.Vessel(id, ItsOwnParent, orbit);

        internal static StateVector SolveConic(
            this IPropagationProvider provider, OrbitElements orbit, double ut) =>
            provider.Solve(Craft(orbit), ut);
    }
}
