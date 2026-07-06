namespace Sitrep.Propagation
{
    /// <summary>
    /// The classical (Keplerian) orbital elements for a body relative to its
    /// parent, plus the epoch/mean-anomaly pair needed to propagate the
    /// orbit forward (or backward) in time.
    ///
    /// Unit convention: ALL angles (<see cref="Inc"/>, <see cref="Lan"/>,
    /// <see cref="ArgPe"/>, <see cref="MeanAnomalyAtEpoch"/>) are in
    /// RADIANS, not degrees. <see cref="Epoch"/> and any UT passed to
    /// <see cref="IPropagationProvider.Solve"/> are in UT seconds (KSP's
    /// universal time) -- never wall-clock. <see cref="Mu"/> is the parent
    /// body's standard gravitational parameter (GM), in the same
    /// length/time units as the resulting <see cref="StateVector"/>
    /// (KSP convention: meters and seconds).
    /// </summary>
    public struct OrbitElements
    {
        /// <summary>Semi-major axis.</summary>
        public double Sma;

        /// <summary>Eccentricity (0 = circular, &lt;1 = elliptical).</summary>
        public double Ecc;

        /// <summary>Inclination, radians.</summary>
        public double Inc;

        /// <summary>Longitude of ascending node, radians.</summary>
        public double Lan;

        /// <summary>Argument of periapsis, radians.</summary>
        public double ArgPe;

        /// <summary>Mean anomaly at <see cref="Epoch"/>, radians.</summary>
        public double MeanAnomalyAtEpoch;

        /// <summary>UT (seconds) at which <see cref="MeanAnomalyAtEpoch"/> is valid.</summary>
        public double Epoch;

        /// <summary>Parent body's standard gravitational parameter (GM).</summary>
        public double Mu;

        public OrbitElements(
            double sma,
            double ecc,
            double inc,
            double lan,
            double argPe,
            double meanAnomalyAtEpoch,
            double epoch,
            double mu)
        {
            Sma = sma;
            Ecc = ecc;
            Inc = inc;
            Lan = lan;
            ArgPe = argPe;
            MeanAnomalyAtEpoch = meanAnomalyAtEpoch;
            Epoch = epoch;
            Mu = mu;
        }
    }
}
