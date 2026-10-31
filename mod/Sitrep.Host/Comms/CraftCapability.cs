using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What a craft could do to leave the path it is reckoned on, as read with
    /// one of its states: how much delta-v it has left, how hard it can push,
    /// how fast it was moving through an atmosphere and whether anything moves
    /// it that burns no propellant, and whether it was under thrust. Each
    /// figure is null where the game gave none, which is not zero.
    /// </summary>
    public sealed class CraftCapability
    {
        public CraftCapability(double? deltaVMs, double? maxAccelerationMs2, double? airspeedMs, bool drivenWithoutPropellant, bool? thrusting = null, ThrustAcceleration? thrustAcceleration = null, ThrustAcceleration? measuredAcceleration = null, double? engineChangeAcceleration = null, IReadOnlyList<CanopyReading>? canopies = null, double? airDensityKgM3 = null, double? deployHeightM = null, double? extentM = null, IReadOnlyList<LockedEngineReading>? lockedEngines = null)
        {
            DeltaVMs = deltaVMs;
            MaxAccelerationMs2 = maxAccelerationMs2;
            AirspeedMs = airspeedMs;
            DrivenWithoutPropellant = drivenWithoutPropellant;
            Thrusting = thrusting;
            ThrustAcceleration = thrustAcceleration;
            MeasuredAcceleration = measuredAcceleration;
            EngineChangeAcceleration = engineChangeAcceleration;
            Canopies = canopies;
            AirDensityKgM3 = airDensityKgM3;
            DeployHeightM = deployHeightM;
            ExtentM = extentM;
            LockedEngines = lockedEngines ?? new LockedEngineReading[0];
        }

        /// <summary>The craft's total delta-v in vacuum, in m/s: the most it can change its velocity by. Null when it was not read.</summary>
        public double? DeltaVMs { get; }

        /// <summary>The largest acceleration any of its stages reaches under full thrust in vacuum, in m/s². Null when it was not read.</summary>
        public double? MaxAccelerationMs2 { get; }

        /// <summary>Its speed relative to the air, in m/s, for a craft inside an atmosphere. Null for one above every atmosphere.</summary>
        public double? AirspeedMs { get; }

        /// <summary>Whether driven wheels or rotors can move it, which they do on the ground and in the air without spending delta-v.</summary>
        public bool DrivenWithoutPropellant { get; }

        /// <summary>
        /// Whether any engine or thruster was producing thrust when the craft was
        /// read: false for a craft coasting, and for one not loaded, which is on
        /// rails and does not burn. Null when it was not read, which is not false.
        /// </summary>
        public bool? Thrusting { get; }

        /// <summary>
        /// The acceleration the craft's engines gave it when it was read, split
        /// along its own prograde, radial and normal directions then. Null when it
        /// was not thrusting, was thrusting on thrusters alone, or none was read.
        /// </summary>
        public ThrustAcceleration? ThrustAcceleration { get; }

        /// <summary>
        /// Every acceleration but gravity's that the game measured on the craft
        /// when it was read, engines, drag and lift together, split along its own
        /// prograde, radial and normal as <see cref="ThrustAcceleration"/> is. Read
        /// only for a loaded craft in an atmosphere that the game is simulating;
        /// null for one on rails and where the game gave no frame to split it in.
        /// </summary>
        public ThrustAcceleration? MeasuredAcceleration { get; }

        /// <summary>
        /// The most the craft's engines can change its acceleration by, in m/s²:
        /// each ignited engine from what it gives now to nothing or to full thrust,
        /// and each engine in the next stage from nothing to full, over the craft's
        /// mass. Read with <see cref="MeasuredAcceleration"/>, and null where that was
        /// not, which is not zero: no engine changes nothing, a craft whose parts
        /// were not read is unknown.
        /// </summary>
        public double? EngineChangeAcceleration { get; }

        /// <summary>
        /// The parachutes that are armed or part open, each as <see cref="CanopyReading"/>
        /// has it. Empty when none can open further; null where the parts were not read.
        /// </summary>
        public IReadOnlyList<CanopyReading>? Canopies { get; }

        /// <summary>The lower of the craft's height above sea level and above the ground below it, in metres, which is what decides whether a canopy may open fully. Null where it was not read.</summary>
        public double? DeployHeightM { get; }

        /// <summary>The air density at the craft when it was read, in kg/m³. Null where it was not read.</summary>
        public double? AirDensityKgM3 { get; }

        /// <summary>
        /// The radius in metres of the sphere round the craft's centre of mass that holds
        /// all of it when it was read: its parts and the canopy of a parachute that was
        /// part or fully open. Null where it was not read.
        /// </summary>
        public double? ExtentM { get; }

        /// <summary>
        /// The ignited engines whose throttle is locked, each with how long its
        /// propellant lasts. Their thrust is not in <see cref="EngineChangeAcceleration"/>:
        /// a locked engine changes nothing until it burns out. Empty where there are none
        /// and where the parts were not read.
        /// </summary>
        public IReadOnlyList<LockedEngineReading> LockedEngines { get; }

        /// <summary>Whether the craft's engines and parachutes were read, so that what they can change is known and not assumed.</summary>
        public bool PartsRead => EngineChangeAcceleration != null && Canopies != null && AirDensityKgM3 != null;
    }
}
