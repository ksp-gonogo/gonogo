namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// One radio path, sampled as a function of time: everything
    /// <see cref="VisibilitySweep"/> needs in order to say when the path opens
    /// and closes, and nothing else.
    ///
    /// <para>The sweep deliberately knows nothing about orbits, bodies or ground
    /// stations. It knows how to find the zeros of a continuous scalar. Splitting
    /// it here is what lets the search be tested against synthetic margin
    /// functions whose roots are known exactly, rather than only against orbits
    /// whose roots are themselves the thing under test.</para>
    /// </summary>
    public interface IVisibilityGeometry
    {
        /// <summary>
        /// A signed margin at <paramref name="ut"/> whose SIGN is the answer:
        /// zero or more is a clear path, negative is a blocked one
        /// (<see cref="ChordOcclusion.Unobstructed"/> is the single copy of that
        /// comparison).
        ///
        /// <para>The magnitude and its units are the implementation's business and
        /// no caller should read anything into them. What every implementation
        /// owes is CONTINUITY in UT, and that the function actually crosses zero
        /// at a state change rather than resting on it. That is a contract, not an
        /// observation: the sweep brackets a sign change and then bisects, so a
        /// margin that jumps, or that sits pinned at exactly zero through a whole
        /// pass, does not merely blunt the search, it invents crossings.
        /// <see cref="ChordOcclusion.HorizonMargin"/> exists because the obvious
        /// metres-of-clearance formulation does exactly that.</para>
        /// </summary>
        double MarginAt(double ut);

        /// <summary>
        /// Straight-line distance in metres between the two endpoints at
        /// <paramref name="ut"/>, whether or not the path is clear. This is what a
        /// prediction gets compared against: a capture reports the separation at
        /// which a link was observed to drop, and the only way to check a
        /// candidate occluding radius is to ask what separation IT predicts.
        /// </summary>
        double SeparationAt(double ut);
    }
}
