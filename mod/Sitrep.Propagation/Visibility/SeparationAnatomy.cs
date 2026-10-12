namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// A vessel-to-station separation split into the two quantities that make it
    /// up, both measured from the centre of the station's body: how far the vessel
    /// is from that centre, and how far the station sits from that centre toward
    /// the vessel.
    ///
    /// <para>The separation satisfies
    /// <c>separation^2 = c^2 + s^2 - 2 * c * p</c> with <c>c</c> the centre to
    /// vessel distance, <c>s</c> the station's distance from the centre and
    /// <c>p</c> the station's projection onto the line to the vessel. Both
    /// <c>c</c> and <c>p</c> are unchanged by a rotation of the whole frame, so a
    /// live reading in KSP's world axes and a prediction in the propagation frame
    /// can be compared term by term without a transform between the two.</para>
    ///
    /// <para>Used by the silence predictor's frame self-check, to say whether a
    /// disagreement lives in where the vessel is (<c>c</c>) or in which way the
    /// station faces on its body (<c>p</c>).</para>
    /// </summary>
    public readonly struct SeparationAnatomy
    {
        public SeparationAnatomy(double centreToVesselMeters, double stationFromCentreMeters, double stationTowardVesselMeters)
        {
            CentreToVesselMeters = centreToVesselMeters;
            StationFromCentreMeters = stationFromCentreMeters;
            StationTowardVesselMeters = stationTowardVesselMeters;
        }

        /// <summary>Distance from the station body's centre to the vessel, metres.</summary>
        public double CentreToVesselMeters { get; }

        /// <summary>Distance from the station body's centre to the station, metres.</summary>
        public double StationFromCentreMeters { get; }

        /// <summary>The station's offset from the centre along the line to the vessel, metres; positive when the station faces the vessel.</summary>
        public double StationTowardVesselMeters { get; }
    }
}
