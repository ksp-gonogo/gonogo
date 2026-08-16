namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// A geometry that can name the shortest cycle in its own motion, so a
    /// caller choosing a sweep step sizes it against the term that actually
    /// moves fastest instead of whichever period it happens to hold.
    ///
    /// <para>Kept off <see cref="IVisibilityGeometry"/> because the sweep does
    /// not need it: the search takes a step as an argument and knows nothing
    /// about what produced the margin, and a synthetic margin function has no
    /// cycle to declare. It is the step-CHOOSING caller that needs this, and
    /// only a geometry built out of moving bodies can answer it.</para>
    ///
    /// <para><b>Why it matters.</b> Visibility from a rotating ground station
    /// cycles at whichever of the orbit and the station's day is faster. A
    /// craft in solar orbit has a period of 1.02e7 s, so a step of period/720
    /// is 14,167 s against Kerbin's 21,549 s day: 1.5 samples per visibility
    /// cycle, under the 2 the sweep needs to see a cycle at all, and the sweep
    /// then walks past emergences and reports a later one as if it were the
    /// first.</para>
    /// </summary>
    public interface IVisibilityCadence
    {
        /// <summary>
        /// The shortest cycle in the geometry's motion, seconds. Always
        /// positive: a retrograde spin cycles just as fast as a prograde one.
        /// </summary>
        double ShortestCycleSeconds { get; }
    }
}
