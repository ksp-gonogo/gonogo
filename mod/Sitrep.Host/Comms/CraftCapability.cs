namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What a craft could do to leave the path it is reckoned on, as read with
    /// one of its states: how much delta-v it has left, how hard it can push,
    /// how fast it was moving through an atmosphere and whether anything moves
    /// it that burns no propellant. Each figure is null where the game gave
    /// none, which is not zero.
    /// </summary>
    public sealed class CraftCapability
    {
        public CraftCapability(double? deltaVMs, double? maxAccelerationMs2, double? airspeedMs, bool drivenWithoutPropellant)
        {
            DeltaVMs = deltaVMs;
            MaxAccelerationMs2 = maxAccelerationMs2;
            AirspeedMs = airspeedMs;
            DrivenWithoutPropellant = drivenWithoutPropellant;
        }

        /// <summary>The craft's total delta-v in vacuum, in m/s: the most it can change its velocity by. Null when it was not read.</summary>
        public double? DeltaVMs { get; }

        /// <summary>The largest acceleration any of its stages reaches under full thrust in vacuum, in m/s². Null when it was not read.</summary>
        public double? MaxAccelerationMs2 { get; }

        /// <summary>Its speed relative to the air, in m/s, for a craft inside an atmosphere. Null for one above every atmosphere.</summary>
        public double? AirspeedMs { get; }

        /// <summary>Whether driven wheels or rotors can move it, which they do on the ground and in the air without spending delta-v.</summary>
        public bool DrivenWithoutPropellant { get; }
    }
}
