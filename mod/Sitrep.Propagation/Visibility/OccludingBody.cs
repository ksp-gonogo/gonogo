namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// A body that can come between two endpoints, and how big it is to a radio
    /// wave.
    ///
    /// <para>An index and a radius, and deliberately nothing else. This replaced a
    /// link that also carried a set of elements and a direction flag, which is what
    /// made a geometry a place where conics were composed; where the body actually
    /// is at a given UT is now the propagation provider's answer to give.</para>
    ///
    /// <para><b>The radius is the model's, not the body's.</b> Stock CommNet shrinks
    /// a body before testing and a network-replacing backend need not, so it arrives from whichever
    /// occlusion model is elected rather than being derived here.</para>
    /// </summary>
    public readonly struct OccludingBody
    {
        public OccludingBody(int bodyIndex, double occludingRadiusMeters)
        {
            BodyIndex = bodyIndex;
            OccludingRadiusMeters = occludingRadiusMeters;
        }

        public int BodyIndex { get; }

        public double OccludingRadiusMeters { get; }
    }
}
