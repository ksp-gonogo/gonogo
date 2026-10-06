namespace Sitrep.Contract
{
    /// <summary>
    /// The shell of space a propagation target stays within: its closest and
    /// furthest distance from the body it orbits, in metres from the body's centre.
    /// A propagation provider returns it from <c>RadiusExtremesOf</c>.
    ///
    /// <para>For a two-body ellipse these are the periapsis and apoapsis radii,
    /// <c>sma * (1 -/+ ecc)</c>. Under other physics they are still the closest
    /// and furthest distances, but no longer at fixed apsides.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public readonly struct RadiusExtremes
    {
        /// <summary>Builds the pair.</summary>
        /// <param name="closestMeters">The closest distance from the body's centre, metres.</param>
        /// <param name="furthestMeters">The furthest distance from the body's centre, metres.</param>
        public RadiusExtremes(double closestMeters, double furthestMeters)
        {
            ClosestMeters = closestMeters;
            FurthestMeters = furthestMeters;
        }

        /// <summary>The closest distance from the body's centre, metres (the periapsis radius of a two-body orbit, not an altitude).</summary>
        public double ClosestMeters { get; }

        /// <summary>The furthest distance from the body's centre, metres (the apoapsis radius of a two-body orbit, not an altitude).</summary>
        public double FurthestMeters { get; }
    }
}
