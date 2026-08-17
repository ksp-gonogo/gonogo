namespace Sitrep.Propagation
{
    /// <summary>
    /// One body as a propagator needs to know it: what it orbits, and on what
    /// elements. A table of these is the map of the system a provider walks when
    /// asked for an answer in a frame centred on something other than the body its
    /// target orbits.
    ///
    /// <para><b>There is deliberately no occluding radius here</b>, and the hole is
    /// the wrong shape to fill. An occluding radius is not a property of a body: it
    /// is a property of a comms occlusion model applied to one. Stock CommNet shrinks
    /// a body before testing (0.9 airless, 0.75 with an atmosphere) and a
    /// network-replacing backend need not, so for Kerbin those are a 450 km and a
    /// 600 km occluder. Storing it here would put a comms assumption inside the
    /// propagation vocabulary, which is the same defect as core naming a mod, one
    /// layer down. The visibility side asks for radii through its own lookup, keyed
    /// on the same body indices as this table.</para>
    /// </summary>
    public readonly struct SystemBody
    {
        /// <param name="parentIndex">Index of the body this one orbits, or -1 for the root.</param>
        /// <param name="orbit">
        /// This body's elements about <paramref name="parentIndex"/>. Null, or not a
        /// bound conic, for a root that has no orbit at all: KSP stores the Sun with
        /// <c>ecc = 1</c> and <c>sma = 0</c>, which is not an orbit and must never
        /// reach a solver.
        /// </param>
        public SystemBody(int parentIndex, OrbitElements? orbit)
        {
            ParentIndex = parentIndex;
            Orbit = orbit;
        }

        public int ParentIndex { get; }

        public OrbitElements? Orbit { get; }
    }
}
