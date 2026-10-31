using System;
using Sitrep.Contract;
using Sitrep.Propagation;

namespace Sitrep.Host.Comms
{
    /// <summary>Where a craft is reckoned to be at an instant, and the radius around it the reckoning is good to.</summary>
    public readonly struct PredictedPlace
    {
        public PredictedPlace(CraftPlace place, double radiusM)
        {
            Place = place;
            RadiusM = radiusM;
        }

        /// <summary>The place, as it reaches a client.</summary>
        public CraftPlace Place { get; }

        /// <summary>How far the craft can be from <see cref="Place"/>, in metres, by the prediction's own error.</summary>
        public double RadiusM { get; }
    }

    /// <summary>
    /// Where a craft last known to be coasting, or to be burning with a thrust
    /// vector read, is at a later instant, from the state the centre heard it in.
    ///
    /// <para><b>Coasting</b> is the Kepler solution of the orbit it was heard on.
    /// <b>Burning</b> holds the acceleration it was heard with fixed in direction
    /// in the body's non-rotating frame and in size, under the body's gravity as a
    /// point mass, until the craft's delta-v is spent, and then coasts. It is
    /// integrated with fourth-order Runge-Kutta at a fixed one-second step and is
    /// not attempted past <see cref="MaxSteps"/> of them. Mass loss, drag, thrust
    /// that is cut or steered earlier and bodies other than the one it orbits are
    /// not modelled.</para>
    ///
    /// <para>The radius of a burning prediction is the held burn's own
    /// displacement, <see cref="PositionUncertainty.FreeFall"/> of the craft's
    /// delta-v at the held acceleration, grown by the gravity gradient as an
    /// ordinary push is and scaled by the combined error of the thrust direction
    /// (<see cref="DirectionError"/>) and size (<see cref="MagnitudeError"/>).</para>
    /// </summary>
    public static class PlacePrediction
    {
        /// <summary>The longest gap, in seconds, a burning craft is carried forward over: one integration step each.</summary>
        public const int MaxSteps = 3600;

        /// <summary>The fixed integration step, in seconds.</summary>
        public const double StepSeconds = 1.0;

        /// <summary>The error assumed in the direction of a held thrust, in radians.</summary>
        public const double DirectionError = 0.1;

        /// <summary>The error assumed in the size of a held thrust, as a fraction of it.</summary>
        public const double MagnitudeError = 0.1;

        private static readonly KeplerProvider Kepler = new KeplerProvider();

        /// <summary>
        /// Where <paramref name="known"/> is at <paramref name="ut"/>, or null when
        /// it cannot be placed: it is not orbiting above the atmosphere, its thrust
        /// was not read, or it is burning and cannot be carried forward that far.
        /// </summary>
        public static PredictedPlace? PlaceAt(CraftState known, double ut)
        {
            var capability = known.Capability;
            if (!known.Exists || known.Orbit is not OrbitElements orbit || known.Surface != null
                || capability == null || capability.Thrusting == null)
            {
                return null;
            }
            if (known.ValidUntilUt is double validUntil && ut > validUntil)
            {
                return null;
            }
            if (capability.AirspeedMs is double airspeed)
            {
                return capability.DrivenWithoutPropellant ? null : Airborne(known, orbit, capability, airspeed, ut);
            }
            if (capability.Thrusting == false || ut <= known.CapturedUt)
            {
                var coast = Kepler.Solve(PropagationTarget.Vessel(known.Id, known.BodyIndex, orbit), ut);
                return new PredictedPlace(new CraftPlace(known.BodyIndex, coast.Position, CraftPlaceBasis.Coasting), 0.0);
            }
            return Burning(known, orbit, capability, ut);
        }

        private static PredictedPlace? Burning(CraftState known, OrbitElements orbit, CraftCapability capability, double ut)
        {
            if (capability.ThrustAcceleration is not ThrustAcceleration thrust || capability.DeltaVMs is not double deltaV)
            {
                return null;
            }
            var elapsed = ut - known.CapturedUt;
            if (elapsed > MaxSteps * StepSeconds)
            {
                return null;
            }
            if (Carried(known, orbit, thrust, deltaV, elapsed) is not Vector3d position)
            {
                return null;
            }
            var gravity = PositionUncertainty.Gravity(orbit, elapsed);
            if (gravity == null)
            {
                return null;
            }
            var error = Math.Sqrt(DirectionError * DirectionError + MagnitudeError * MagnitudeError);
            var radius = error * gravity.Value * PositionUncertainty.FreeFall(deltaV, thrust.Magnitude, elapsed);
            return new PredictedPlace(new CraftPlace(known.BodyIndex, position, CraftPlaceBasis.Burning), radius);
        }

        /// <summary>The place the held thrust carries the craft to over <paramref name="elapsed"/> seconds from its capture, or null when the thrust cannot be held in the body's frame or has no size.</summary>
        private static Vector3d? Carried(CraftState known, OrbitElements orbit, ThrustAcceleration thrust, double deltaV, double elapsed)
        {
            var start = Kepler.Solve(PropagationTarget.Vessel(known.Id, known.BodyIndex, orbit), known.CapturedUt);
            if (thrust.InFrameOf(start.Position, start.Velocity) is not Vector3d held)
            {
                return null;
            }
            var magnitude = thrust.Magnitude;
            if (!(magnitude > 0.0) || !(deltaV >= 0.0))
            {
                return null;
            }
            var burnSeconds = deltaV / magnitude;
            var position = start.Position;
            var velocity = start.Velocity;
            var t = 0.0;
            while (t < elapsed)
            {
                var step = Math.Min(StepSeconds, elapsed - t);
                var pushing = t < burnSeconds;
                if (pushing)
                {
                    step = Math.Min(step, burnSeconds - t);
                }
                var push = pushing ? held : new Vector3d(0.0, 0.0, 0.0);
                Advance(ref position, ref velocity, push, orbit.Mu, step);
                t += step;
            }
            return position;
        }

        /*
         * A craft in the atmosphere is carried forward on the orbit it was heard on,
         * with its held thrust while it is thrusting, as one above it is. Drag and lift
         * are not modelled, so they are in the radius: the most the air can move the
         * craft off that path is what stopping it would, and the most its engines can is
         * what they would do from a cut to flat out. The gravity gradient is read at the
         * craft's own radius, as it would be for a circular orbit there, since the
         * eccentric factor of a steep sub-orbital arc is far larger than anything a gap
         * in the air can reach.
         */
        private static PredictedPlace? Airborne(CraftState known, OrbitElements orbit, CraftCapability capability, double airspeed, double ut)
        {
            var thrusting = capability.Thrusting == true;
            if (thrusting && capability.DeltaVMs == null)
            {
                return null;
            }
            var elapsed = ut - known.CapturedUt;
            if (elapsed > MaxSteps * StepSeconds)
            {
                return null;
            }
            var start = Kepler.Solve(PropagationTarget.Vessel(known.Id, known.BodyIndex, orbit), known.CapturedUt);
            if (elapsed <= 0.0)
            {
                return new PredictedPlace(new CraftPlace(known.BodyIndex, start.Position, CraftPlaceBasis.Coasting), 0.0);
            }
            var basis = CraftPlaceBasis.Coasting;
            Vector3d? carried = null;
            if (thrusting && capability.ThrustAcceleration is ThrustAcceleration thrust)
            {
                carried = Carried(known, orbit, thrust, capability.DeltaVMs!.Value, elapsed);
                basis = CraftPlaceBasis.Burning;
            }
            if (carried == null)
            {
                carried = Kepler.Solve(PropagationTarget.Vessel(known.Id, known.BodyIndex, orbit), ut).Position;
                basis = CraftPlaceBasis.Coasting;
            }
            var turn = Math.Sqrt(orbit.Mu / Math.Pow(start.Position.Magnitude(), 3.0));
            var gravity = PositionUncertainty.CircularGravityAt(turn * elapsed);
            var push = thrusting
                ? PositionUncertainty.FreeFall(capability.DeltaVMs!.Value, capability.MaxAccelerationMs2 ?? capability.ThrustAcceleration?.Magnitude, elapsed)
                : 0.0;
            var air = PositionUncertainty.FreeFall(airspeed, PositionUncertainty.AeroAcceleration(airspeed), elapsed);
            return new PredictedPlace(new CraftPlace(known.BodyIndex, carried.Value, basis), gravity * (push + air));
        }

        private static void Advance(ref Vector3d position, ref Vector3d velocity, Vector3d push, double mu, double h)
        {
            var k1v = Acceleration(position, push, mu);
            var k1r = velocity;
            var k2v = Acceleration(position + k1r * (h / 2.0), push, mu);
            var k2r = velocity + k1v * (h / 2.0);
            var k3v = Acceleration(position + k2r * (h / 2.0), push, mu);
            var k3r = velocity + k2v * (h / 2.0);
            var k4v = Acceleration(position + k3r * h, push, mu);
            var k4r = velocity + k3v * h;
            position = position + (k1r + k2r * 2.0 + k3r * 2.0 + k4r) * (h / 6.0);
            velocity = velocity + (k1v + k2v * 2.0 + k3v * 2.0 + k4v) * (h / 6.0);
        }

        private static Vector3d Acceleration(Vector3d position, Vector3d push, double mu)
        {
            var r = position.Magnitude();
            return position * (-mu / (r * r * r)) + push;
        }
    }
}
