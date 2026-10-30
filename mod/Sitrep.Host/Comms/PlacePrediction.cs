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
                || capability == null || capability.AirspeedMs != null || capability.Thrusting == null)
            {
                return null;
            }
            if (known.ValidUntilUt is double validUntil && ut > validUntil)
            {
                return null;
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
            var gravity = PositionUncertainty.Gravity(orbit, elapsed);
            if (gravity == null)
            {
                return null;
            }
            var error = Math.Sqrt(DirectionError * DirectionError + MagnitudeError * MagnitudeError);
            var radius = error * gravity.Value * PositionUncertainty.FreeFall(deltaV, magnitude, elapsed);
            return new PredictedPlace(new CraftPlace(known.BodyIndex, position, CraftPlaceBasis.Burning), radius);
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
