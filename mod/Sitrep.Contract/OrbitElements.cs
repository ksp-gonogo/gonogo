namespace Sitrep.Contract
{
    /// <summary>
    /// The classical (Keplerian) orbital elements for a body relative to its
    /// parent, plus the epoch/mean-anomaly pair needed to propagate the
    /// orbit forward (or backward) in time.
    ///
    /// <para>Unit convention: all angles (<see cref="Inc"/>, <see cref="Lan"/>,
    /// <see cref="ArgPe"/>, <see cref="MeanAnomalyAtEpoch"/>) are in RADIANS,
    /// not degrees, unlike KSP's own <c>Orbit</c>; build from KSP values with
    /// <see cref="FromKspDegrees"/>. <see cref="Epoch"/> and any UT passed to
    /// <see cref="IPropagationProvider.Solve"/> are universal time in seconds,
    /// never wall-clock. Lengths are metres and <see cref="Mu"/> is in
    /// m³/s², matching the resulting <see cref="StateVector"/>.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public struct OrbitElements
    {
        /// <summary>Semi-major axis, in metres.</summary>
        public double Sma;

        /// <summary>Eccentricity (0 = circular, &lt;1 = elliptical, 1 or more = escape).</summary>
        public double Ecc;

        /// <summary>Inclination, radians.</summary>
        public double Inc;

        /// <summary>Longitude of ascending node, radians.</summary>
        public double Lan;

        /// <summary>Argument of periapsis, radians.</summary>
        public double ArgPe;

        /// <summary>Mean anomaly at <see cref="Epoch"/>, radians.</summary>
        public double MeanAnomalyAtEpoch;

        /// <summary>Universal time, in seconds, at which <see cref="MeanAnomalyAtEpoch"/> is valid.</summary>
        public double Epoch;

        /// <summary>Parent body's standard gravitational parameter (GM), in m³/s².</summary>
        public double Mu;

        /// <summary>
        /// Creates an element set from values already in radians. For KSP's
        /// own degree values use <see cref="FromKspDegrees"/>.
        /// </summary>
        /// <param name="sma">Semi-major axis, in metres.</param>
        /// <param name="ecc">Eccentricity.</param>
        /// <param name="inc">Inclination, in radians.</param>
        /// <param name="lan">Longitude of the ascending node, in radians.</param>
        /// <param name="argPe">Argument of periapsis, in radians.</param>
        /// <param name="meanAnomalyAtEpoch">Mean anomaly at <paramref name="epoch"/>, in radians.</param>
        /// <param name="epoch">Universal time, in seconds, at which the mean anomaly is valid.</param>
        /// <param name="mu">The parent body's gravitational parameter, in m³/s².</param>
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

        /// <summary>
        /// Elements from KSP's own units: <c>Orbit.inclination</c>,
        /// <c>Orbit.LAN</c> and <c>Orbit.argumentOfPeriapsis</c> are DEGREES,
        /// while <c>Orbit.meanAnomalyAtEpoch</c> is already radians.
        ///
        /// <para>Every caller holding KSP values must come through here. Passing
        /// the degree values to the normal constructor compiles and runs and
        /// yields a rotated orbit, a plausible number in the wrong place.</para>
        /// </summary>
        /// <returns>The element set with every angle in radians.</returns>
        public static OrbitElements FromKspDegrees(
            double sma,
            double ecc,
            double incDegrees,
            double lanDegrees,
            double argPeDegrees,
            double meanAnomalyAtEpochRadians,
            double epoch,
            double mu)
        {
            const double ToRadians = System.Math.PI / 180.0;
            return new OrbitElements(
                sma,
                ecc,
                incDegrees * ToRadians,
                lanDegrees * ToRadians,
                argPeDegrees * ToRadians,
                meanAnomalyAtEpochRadians,
                epoch,
                mu);
        }
    }
}
