namespace Sitrep.Host.Comms
{
    /// <summary>
    /// One parachute that is armed or part open, as read with the craft: what it
    /// would give the craft in each of the two states it can still reach, and what
    /// decides whether it gets there.
    /// </summary>
    public sealed class CanopyReading
    {
        public CanopyReading(double semiPerPressure, double fullPerPressure, double deployAltitudeM, double? safeSpeedMs)
        {
            SemiPerPressure = semiPerPressure;
            FullPerPressure = fullPerPressure;
            DeployAltitudeM = deployAltitudeM;
            SafeSpeedMs = safeSpeedMs;
        }

        /// <summary>The acceleration it gives the craft part open, per unit of half the air density times the speed squared, from <see cref="ParachuteDrag.PerPressure"/>.</summary>
        public double SemiPerPressure { get; }

        /// <summary>The same fully open.</summary>
        public double FullPerPressure { get; }

        /// <summary>The height, in metres, below which the game lets the canopy open fully: above sea level or above the ground below the part.</summary>
        public double DeployAltitudeM { get; }

        /// <summary>The speed, in m/s, at which a canopy the game is holding back at the craft's speed would open; null for one that opens now.</summary>
        public double? SafeSpeedMs { get; }
    }
}
