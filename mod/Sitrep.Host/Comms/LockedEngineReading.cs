namespace Sitrep.Host.Comms
{
    /// <summary>
    /// An ignited engine whose throttle cannot move, a solid motor: it can only lose
    /// its thrust, and only when its propellant runs out. Read with
    /// <see cref="CraftCapability.LockedEngines"/>.
    /// </summary>
    public sealed class LockedEngineReading
    {
        public LockedEngineReading(double accelerationMs2, double burnSeconds)
        {
            AccelerationMs2 = accelerationMs2;
            BurnSeconds = burnSeconds;
        }

        /// <summary>The acceleration it gives the craft now, in m/s²: its thrust over the craft's mass.</summary>
        public double AccelerationMs2 { get; }

        /// <summary>How long its propellant lasts at the rate it burns now, in seconds. Zero where that could not be told, which counts as burning out at once.</summary>
        public double BurnSeconds { get; }
    }
}
