using System;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// How far a craft can be from the place gonogo reckons it at, given what
    /// it could have done since its place was last known: a radius in metres
    /// around gonogo's own reference position, never around the true craft.
    ///
    /// <para>The craft leaves the reference only by its own push, and the
    /// furthest it can get is to spend its delta-v flat out at once and then
    /// coast. Over longer gaps the gravity gradient turns a small change of
    /// velocity into along-track drift, which the linearised relative motion
    /// about the orbit bounds. An atmosphere adds what drag and lift can do
    /// with the craft's own airspeed.</para>
    /// </summary>
    public static class PositionUncertainty
    {
        private const int GravityTableSteps = 4096;

        /// <summary>
        /// The least deceleration, in metres per second squared, the air is allowed
        /// to add to a craft's motion in a gap: a parachute opening is a few times
        /// gravity. A first value awaiting a measurement on the rig.
        /// </summary>
        public const double AeroFloorAccelerationMs2 = 50.0;

        /// <summary>
        /// The speed at which a blunt craft with no parachute stops gaining speed
        /// falling through air at sea level, in metres per second. A first value
        /// awaiting a measurement on the rig, taken low so the bound is never under
        /// the drag of a capsule at speed.
        /// </summary>
        public const double BluntTerminalSpeedMs = 100.0;

        private const double StandardGravityMs2 = 9.80665;

        /// <summary>
        /// The gravity factor of a circular orbit at each step of its first
        /// turn: the most a velocity change applied up to that many radians of
        /// mean motion earlier has moved the craft, per m/s per second.
        /// Constant from the end of the turn on.
        /// </summary>
        private static readonly double[] CircularGravity = CircularGravityTable();

        /// <summary>
        /// The radius, in metres, within which the craft lies at
        /// <paramref name="ut"/> if its place was known at
        /// <paramref name="sinceUt"/>. Zero at <paramref name="sinceUt"/>.
        /// A craft last heard not under thrust is bounded as if it had no delta-v,
        /// whatever it carries. Null when it cannot be bounded: its delta-v was
        /// never heard and it was not heard coasting, it is gone, the gap runs
        /// past how far its orbit can be trusted, its orbit is parabolic, or
        /// wheels or rotors can move it where it is.
        /// </summary>
        /// <param name="known">The craft as the centre knows it: where it was going and what it could do.</param>
        public static double? Bound(CraftState known, double sinceUt, double ut)
        {
            if (!known.Exists)
            {
                return null;
            }
            var elapsed = ut - sinceUt;
            if (elapsed <= 0)
            {
                return 0.0;
            }
            if (IsSpaceObject(known))
            {
                return 0.0;
            }
            var capability = known.Capability;
            if (capability == null || (known.Orbit == null && known.Surface == null))
            {
                return null;
            }
            // A craft last heard coasting stays coasting: the bound does not
            // grow with what its propellant could have done, so an autonomous
            // burn after it was heard takes the craft out of the bound.
            var coasting = capability.Thrusting == false;
            if (!coasting && capability.DeltaVMs == null)
            {
                return null;
            }
            var deltaV = coasting ? 0.0 : capability.DeltaVMs!.Value;
            if (known.ValidUntilUt is double validUntil && ut > validUntil)
            {
                return null;
            }
            if (capability.Thrusting == true && PlacePrediction.PlaceAt(known, ut) is { } burning)
            {
                return burning.RadiusM;
            }
            if (known.Surface == null && capability.AirspeedMs != null && known.Orbit != null && PlacePrediction.PlaceAt(known, ut) is { } airborne)
            {
                return airborne.RadiusM;
            }
            var airborneOrGrounded = known.Surface != null || capability.AirspeedMs != null;
            if (airborneOrGrounded && capability.DrivenWithoutPropellant)
            {
                return null;
            }
            var pushed = FreeFall(deltaV, capability.MaxAccelerationMs2, elapsed);
            var air = capability.AirspeedMs is double airspeed ? 2.0 * airspeed * elapsed : 0.0;
            if (pushed == 0.0 || airborneOrGrounded)
            {
                return pushed + air;
            }
            var gravity = Gravity(known.Orbit!.Value, elapsed);
            return gravity == null ? null : gravity * pushed + air;
        }

        /// <summary>
        /// The most the air can slow or turn a craft moving at
        /// <paramref name="airspeed"/>, in metres per second squared: drag grows
        /// with the square of speed, so at the speed a blunt craft would fall at
        /// it equals gravity, and below that the floor holds.
        /// </summary>
        public static double AeroAcceleration(double airspeed)
        {
            var ratio = airspeed / BluntTerminalSpeedMs;
            return Math.Max(AeroFloorAccelerationMs2, StandardGravityMs2 * ratio * ratio);
        }

        /// <summary>
        /// The most the air can move a craft in the atmosphere off the path it is
        /// reckoned on over <paramref name="elapsed"/> seconds: <see cref="FreeFall"/>
        /// of <see cref="AeroAcceleration"/>, limited by the speed there is to take
        /// away. That is the craft's airspeed plus what gravity gives a path that
        /// has no drag over the gap, <paramref name="gravity"/> times
        /// <paramref name="elapsed"/>, since a prediction that leaves drag out is
        /// ahead of a craft the air holds at terminal speed by exactly that.
        /// </summary>
        public static double AirDeviation(double airspeed, double gravity, double elapsed) =>
            FreeFall(airspeed + gravity * elapsed, AeroAcceleration(airspeed), elapsed);

        /// <summary>
        /// The error of holding the craft's measured acceleration, as a fraction of it,
        /// the same order as <see cref="PlacePrediction.DirectionError"/> and
        /// <see cref="PlacePrediction.MagnitudeError"/> together.
        /// </summary>
        public const double MeasuredAccelerationError = 0.1;

        /// <summary>The smallest error, in m/s², the game's smoothed reading of a craft's acceleration can carry.</summary>
        public const double MeasuredAccelerationResolution = 0.1;

        /// <summary>
        /// What the craft's own parts can move it off the path it is reckoned on, over
        /// <paramref name="elapsed"/> seconds, when its engines and parachutes were
        /// read: the error of holding its measured acceleration, what each ignited
        /// engine (and each one in the next stage) can change it by, and what a
        /// parachute that is armed or part open would add in the furthest state it can
        /// reach in the gap (part open, or fully open once the craft can fall below the
        /// height the game opens it at) at this speed and air density, limited by the
        /// speed there is to take away. An armed parachute the game holds back at this
        /// speed would open at its safe speed, so it counts at that speed. A part that cannot
        /// change anything adds nothing.
        /// </summary>
        /// <param name="measuredMs2">The size of the acceleration held.</param>
        /// <param name="pull">What gravity pulls the craft with, in m/s².</param>
        public static double PartsDeviation(CraftCapability capability, double measuredMs2, double airspeed, double pull, double elapsed)
        {
            var held = 0.5 * (MeasuredAccelerationError * measuredMs2 + MeasuredAccelerationResolution) * elapsed * elapsed;
            var engines = FreeFall(capability.DeltaVMs ?? 1e9, capability.EngineChangeAcceleration!.Value, elapsed);
            var pressure = 0.0;
            foreach (var canopy in capability.Canopies!)
            {
                // Open fully only below the height the game lets it, which the craft can fall to in the gap.
                var descent = airspeed * elapsed + 0.5 * pull * elapsed * elapsed;
                var full = capability.DeployHeightM is not double height || height - descent < canopy.DeployAltitudeM;
                var per = full ? canopy.FullPerPressure : canopy.SemiPerPressure;
                var speed = canopy.SafeSpeedMs is double safe ? Math.Min(airspeed, safe) : airspeed;
                pressure += per * speed * speed;
            }
            var acceleration = 0.5 * capability.AirDensityKgM3!.Value * pressure;
            var chute = FreeFall(airspeed + pull * elapsed, acceleration, elapsed);
            return held + engines + chute;
        }

        /// <summary>
        /// What the engines and the air can move a craft off the path it is reckoned on
        /// when its parts were not read: its engines from a cut to flat out, and the air
        /// by <see cref="AirDeviation"/>.
        /// </summary>
        public static double FloorDeviation(CraftCapability capability, double airspeed, double pull, double elapsed)
        {
            var push = capability.Thrusting == true
                ? FreeFall(capability.DeltaVMs!.Value, capability.MaxAccelerationMs2 ?? capability.ThrustAcceleration?.Magnitude, elapsed)
                : 0.0;
            return push + AirDeviation(airspeed, pull, elapsed);
        }

        /// <summary>
        /// How far a craft with <paramref name="deltaV"/> and
        /// <paramref name="acceleration"/> can get in <paramref name="elapsed"/>
        /// seconds from where it would have been, in a frame falling with it:
        /// burning flat out at once and then coasting. An unknown acceleration
        /// is taken as an instant burn, which bounds every finite one.
        /// </summary>
        public static double FreeFall(double deltaV, double? acceleration, double elapsed)
        {
            if (deltaV <= 0 || elapsed <= 0 || acceleration <= 0)
            {
                return 0.0;
            }
            if (acceleration is not double a)
            {
                return deltaV * elapsed;
            }
            var burn = deltaV / a;
            return elapsed <= burn ? 0.5 * a * elapsed * elapsed : deltaV * elapsed - deltaV * deltaV / (2.0 * a);
        }

        /// <summary>
        /// How much the gravity gradient of <paramref name="orbit"/> can grow a
        /// free-fall displacement over <paramref name="elapsed"/> seconds, or
        /// null for a parabolic orbit, which has no bound.
        ///
        /// <para>Exact for a circular orbit. An eccentric one drifts faster near
        /// periapsis by the speed ratio that sets its change of period, so the
        /// gravity-driven part is scaled by it and timed by the angular rate at
        /// periapsis, the fastest the craft turns.</para>
        /// </summary>
        public static double? Gravity(OrbitElements orbit, double elapsed)
        {
            var e = orbit.Ecc;
            var periapsis = orbit.Sma * (1.0 - e);
            if (Math.Abs(1.0 - e) < 1e-9 || periapsis <= 0 || orbit.Mu <= 0)
            {
                return null;
            }
            var turnRate = Math.Sqrt(orbit.Mu * (1.0 + e) / (periapsis * periapsis * periapsis));
            var speedRatio = (1.0 + e) / Math.Abs(1.0 - e);
            return 1.0 + (CircularGravityAt(turnRate * elapsed) - 1.0) * speedRatio;
        }

        /// <summary>The circular gravity factor after <paramref name="radians"/> of mean motion, read at the next step up so it is never under.</summary>
        public static double CircularGravityAt(double radians)
        {
            if (radians <= 0)
            {
                return 1.0;
            }
            var step = (int)Math.Ceiling(radians / (2.0 * Math.PI) * GravityTableSteps);
            return CircularGravity[Math.Min(step, GravityTableSteps)];
        }

        /*
         * Clohessy-Wiltshire: a velocity change applied θ/n seconds ago has moved
         * the craft by M(θ)/n times it, in-plane M = [[sin θ, 2(1 - cos θ)],
         * [-2(1 - cos θ), 4 sin θ - 3θ]], out of plane sin θ. Bounding a burn of
         * any shape needs a factor that does not fall, so each step holds the
         * largest singular value of M(s)/s for every s up to it. It climbs from 1
         * to its ceiling of 3.954 about three quarters of a turn in and never
         * exceeds it later: the secular drift settles at 3.
         */
        private static double[] CircularGravityTable()
        {
            var table = new double[GravityTableSteps + 1];
            var most = 1.0;
            table[0] = 1.0;
            for (var i = 1; i <= GravityTableSteps; i++)
            {
                var theta = 2.0 * Math.PI * i / GravityTableSteps;
                var sin = Math.Sin(theta);
                var fall = 2.0 * (1.0 - Math.Cos(theta));
                most = Math.Max(most, LargestSingularValue(sin, fall, -fall, 4.0 * sin - 3.0 * theta) / theta);
                table[i] = most;
            }
            return table;
        }

        private static double LargestSingularValue(double a, double b, double c, double d)
        {
            var sum = a * a + b * b + c * c + d * d;
            var det = a * d - b * c;
            return Math.Sqrt((sum + Math.Sqrt(Math.Max(0.0, sum * sum - 4.0 * det * det))) / 2.0);
        }

        /// <summary>An asteroid or a comet, which a telescope can tell and which has no engines.</summary>
        private static bool IsSpaceObject(CraftState known) =>
            known.Roster != null && known.Roster.TryGetValue("vesselType", out var type) && type is int kind && kind == (int)VesselType.SpaceObject;
    }
}
