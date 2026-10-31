using System;
using System.Collections.Generic;
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

        /// <summary>How long, in seconds, a craft's measured acceleration is held when it is carried forward: long enough for a gap between captures, short enough that an engine cut or a parachute cut away is not carried on for minutes.</summary>
        public const double MeasuredHoldSeconds = 10.0;

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
            if (!(thrust.Magnitude > 0.0) || !(deltaV >= 0.0)
                || Carried(known, orbit, thrust, deltaV / thrust.Magnitude, elapsed) is not Vector3d position)
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

        /// <summary>The place the held acceleration carries the craft to over <paramref name="elapsed"/> seconds from its capture, held for <paramref name="holdSeconds"/> of them and coasting after, or null when it cannot be held in the body's frame or has no size.</summary>
        private static Vector3d? Carried(CraftState known, OrbitElements orbit, ThrustAcceleration thrust, double holdSeconds, double elapsed, IReadOnlyList<(double At, double Acceleration)>? burnouts = null, ThrustAcceleration? engines = null)
        {
            var start = Kepler.Solve(PropagationTarget.Vessel(known.Id, known.BodyIndex, orbit), known.CapturedUt);
            if (thrust.InFrameOf(start.Position, start.Velocity) is not Vector3d held)
            {
                return null;
            }
            if (!(thrust.Magnitude > 0.0))
            {
                return null;
            }
            var burnSeconds = holdSeconds;
            var position = start.Position;
            var velocity = start.Velocity;
            // A burnout takes its engine's share of the held acceleration away, along the engines' own thrust where that is known.
            var along = engines is ThrustAcceleration thrusting && thrusting.Magnitude > 0.0 && thrusting.InFrameOf(start.Position, start.Velocity) is Vector3d unit
                ? unit * (1.0 / thrusting.Magnitude)
                : held * (1.0 / thrust.Magnitude);
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
                if (burnouts != null && pushing)
                {
                    foreach (var burnout in burnouts)
                    {
                        if (burnout.At > t)
                        {
                            step = Math.Min(step, burnout.At - t);
                            continue;
                        }
                        push = push - along * burnout.Acceleration;
                    }
                }
                Advance(ref position, ref velocity, push, orbit.Mu, step);
                t += step;
            }
            return position;
        }

        /*
         * A craft in the atmosphere is carried forward on the orbit it was heard on,
         * under the acceleration the game measured on it at the capture (engines, drag
         * and lift together) held for MeasuredHoldSeconds, so a craft at terminal speed
         * under a parachute holds its velocity where a ballistic path would fall away
         * from it. Without a measurement it keeps its held engine thrust while it is
         * thrusting, and coasts otherwise. What the radius covers is the change in
         * that acceleration over the gap: the engines from a cut to flat out, and the
         * air by the most it can add or take away, which the craft's speed through it
         * and the speed gravity would have given a ballistic path limit. The gravity
         * gradient is read at the craft's own radius, as it would be for a circular
         * orbit there, since the eccentric factor of a steep sub-orbital arc is far
         * larger than anything a gap in the air can reach.
         */
        /// <summary>
        /// What the radius of a craft in the air at <paramref name="ut"/> is made of, as
        /// one line of name=value pairs: the elapsed time, the speed and height it was
        /// read at, each term of its bound and what the bound counts of its parts. Null
        /// where the craft's parts were not read.
        /// </summary>
        public static string? DescribeBound(CraftState known, double ut)
        {
            if (!known.Exists || known.Orbit is not OrbitElements orbit || known.Capability is not { PartsRead: true } capability
                || capability.MeasuredAcceleration is not ThrustAcceleration held || capability.AirspeedMs is not double airspeed)
            {
                return null;
            }
            var elapsed = ut - known.CapturedUt;
            if (!(elapsed > 0.0))
            {
                return null;
            }
            var height = Kepler.Solve(PropagationTarget.Vessel(known.Id, known.BodyIndex, orbit), known.CapturedUt).Position.Magnitude();
            var terms = PositionUncertainty.PartsTerms(capability, held.Magnitude, airspeed, orbit.Mu / (height * height), elapsed);
            var altitude = double.PositiveInfinity;
            foreach (var canopy in capability.Canopies!)
            {
                altitude = Math.Min(altitude, canopy.DeployAltitudeM);
            }
            var format = System.Globalization.CultureInfo.InvariantCulture;
            return string.Format(
                format,
                "craft={0} elapsed={1:F2} airspeedMs={2:F1} heightM={3:F0} deployAltitudeM={4} heldM={5:F1} enginesM={6:F1} chuteM={7:F1} canopies={8} lockedEngines={9}",
                known.Id, elapsed, airspeed, capability.DeployHeightM ?? double.NaN, double.IsInfinity(altitude) ? "none" : altitude.ToString("F0", format), terms.Held, terms.Engines, terms.Chute,
                capability.Canopies.Count, capability.LockedEngines.Count);
        }

        /// <summary>When each locked engine whose burn time was read runs out, and what it gives the craft until then.</summary>
        private static IReadOnlyList<(double At, double Acceleration)>? Burnouts(CraftCapability capability)
        {
            List<(double At, double Acceleration)>? burnouts = null;
            foreach (var locked in capability.LockedEngines)
            {
                if (locked.BurnSeconds > 0.0)
                {
                    (burnouts ??= new List<(double At, double Acceleration)>()).Add((locked.BurnSeconds, locked.AccelerationMs2));
                }
            }
            return burnouts;
        }

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
            if (capability.MeasuredAcceleration is ThrustAcceleration measured)
            {
                carried = Carried(known, orbit, measured, MeasuredHoldSeconds, elapsed, Burnouts(capability), capability.ThrustAcceleration);
                basis = CraftPlaceBasis.Burning;
            }
            if (carried == null && thrusting && capability.ThrustAcceleration is ThrustAcceleration thrust && thrust.Magnitude > 0.0)
            {
                carried = Carried(known, orbit, thrust, capability.DeltaVMs!.Value / thrust.Magnitude, elapsed);
                basis = CraftPlaceBasis.Burning;
            }
            if (carried == null)
            {
                carried = Kepler.Solve(PropagationTarget.Vessel(known.Id, known.BodyIndex, orbit), ut).Position;
                basis = CraftPlaceBasis.Coasting;
            }
            var height = start.Position.Magnitude();
            var turn = Math.Sqrt(orbit.Mu / Math.Pow(height, 3.0));
            var gravity = PositionUncertainty.CircularGravityAt(turn * elapsed);
            var pull = orbit.Mu / (height * height);
            var covered = capability.PartsRead && capability.MeasuredAcceleration is ThrustAcceleration held
                ? PositionUncertainty.PartsDeviation(capability, held.Magnitude, airspeed, pull, elapsed)
                : PositionUncertainty.FloorDeviation(capability, airspeed, pull, elapsed);
            return new PredictedPlace(new CraftPlace(known.BodyIndex, carried.Value, basis), gravity * covered);
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
