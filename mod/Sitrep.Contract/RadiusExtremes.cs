namespace Sitrep.Contract
{
    /// <summary>
    /// The shell of space a target stays within: how close in and how far out it gets
    /// from the body it orbits, metres.
    ///
    /// <para>Two numbers rather than a pair of named apsides, because periapsis and
    /// apoapsis are two-body words. A craft under any physics has a closest and a
    /// furthest approach; only a two-body one has them at fixed points that
    /// <c>sma * (1 +/- ecc)</c> can be written out for at a call site, which is exactly
    /// how this arithmetic came to be duplicated outside any provider in the first
    /// place.</para>
    /// </summary>
    public readonly struct RadiusExtremes
    {
        public RadiusExtremes(double closestMeters, double furthestMeters)
        {
            ClosestMeters = closestMeters;
            FurthestMeters = furthestMeters;
        }

        public double ClosestMeters { get; }

        public double FurthestMeters { get; }
    }
}
