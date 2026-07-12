namespace Sitrep.Propagation
{
    /// <summary>
    /// A capability that turns a set of orbital elements plus a UT into a
    /// parent-body-relative state vector (position + velocity). This is the
    /// dead-reckoning foundation for the streaming model: we transmit sparse
    /// orbital elements over the wire and let each consumer (the mod, the
    /// SDK) derive position on demand, rather than streaming dense position
    /// samples every tick.
    ///
    /// Deliberately an interface, not a static method: propagation is a
    /// swappable capability. <see cref="KeplerProvider"/> is the two-body
    /// analytic solver used by default; a future Principia-aware provider
    /// (n-body, non-Keplerian) would be a second implementation of this
    /// same contract.
    /// </summary>
    public interface IPropagationProvider
    {
        /// <summary>
        /// Solve for the state vector of <paramref name="orbit"/> at time
        /// <paramref name="ut"/> (UT seconds). Must be deterministic --
        /// same inputs, same outputs, no wall-clock/random dependence.
        /// </summary>
        StateVector Solve(OrbitElements orbit, double ut);
    }
}
