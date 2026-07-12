using System;
using Xunit;
using Sitrep.Propagation;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// Hand-verifiable known vectors for the simplest case: a circular
    /// (ecc=0), equatorial (inc=0) orbit with mu=1, sma=1, so mean motion
    /// n = sqrt(mu/sma^3) = 1 and circular speed = sqrt(mu/sma) = 1 -- every
    /// expected value below is a clean number you can check by hand.
    /// </summary>
    public class CircularEquatorialOrbitTests
    {
        private const double Tolerance = 1e-9;

        private static OrbitElements CircularOrbit()
        {
            return new OrbitElements(
                sma: 1.0,
                ecc: 0.0,
                inc: 0.0,
                lan: 0.0,
                argPe: 0.0,
                meanAnomalyAtEpoch: 0.0,
                epoch: 0.0,
                mu: 1.0);
        }

        [Fact]
        public void PositionMagnitudeEqualsSemiMajorAxis()
        {
            var provider = new KeplerProvider();
            var orbit = CircularOrbit();

            // Sample several UTs -- for a circular orbit |position| == sma
            // at every point on the orbit, not just at special anomalies.
            foreach (double ut in new[] { 0.0, 0.7, 1.5, 3.0, 4.4, 6.0 })
            {
                StateVector state = provider.Solve(orbit, ut);
                Assert.Equal(orbit.Sma, state.Position.Magnitude(), 9);
            }
        }

        [Fact]
        public void VelocityMagnitudeEqualsCircularSpeed()
        {
            var provider = new KeplerProvider();
            var orbit = CircularOrbit();
            double expectedSpeed = Math.Sqrt(orbit.Mu / orbit.Sma); // = 1.0

            foreach (double ut in new[] { 0.0, 0.7, 1.5, 3.0, 4.4, 6.0 })
            {
                StateVector state = provider.Solve(orbit, ut);
                Assert.Equal(expectedSpeed, state.Velocity.Magnitude(), 9);
            }
        }

        [Fact]
        public void AtMeanAnomalyZero_PositionIsOnReferenceAxis()
        {
            var provider = new KeplerProvider();
            var orbit = CircularOrbit();

            // n = 1, meanAnomalyAtEpoch = 0, epoch = 0 => M(ut=0) = 0.
            StateVector state = provider.Solve(orbit, 0.0);

            Assert.Equal(1.0, state.Position.X, Tolerance);
            Assert.Equal(0.0, state.Position.Y, Tolerance);
            Assert.Equal(0.0, state.Position.Z, Tolerance);

            // Prograde tangential velocity at periapsis-equivalent point on a
            // circular orbit points along +Y with magnitude 1.
            Assert.Equal(0.0, state.Velocity.X, Tolerance);
            Assert.Equal(1.0, state.Velocity.Y, Tolerance);
            Assert.Equal(0.0, state.Velocity.Z, Tolerance);
        }

        [Fact]
        public void AtMeanAnomalyPi_PositionIsDiametricallyOpposite()
        {
            var provider = new KeplerProvider();
            var orbit = CircularOrbit();

            // n = 1 => M(ut) = ut. M = pi at ut = pi.
            StateVector state = provider.Solve(orbit, Math.PI);

            Assert.Equal(-1.0, state.Position.X, Tolerance);
            Assert.Equal(0.0, state.Position.Y, Tolerance);
            Assert.Equal(0.0, state.Position.Z, Tolerance);

            Assert.Equal(0.0, state.Velocity.X, Tolerance);
            Assert.Equal(-1.0, state.Velocity.Y, Tolerance);
            Assert.Equal(0.0, state.Velocity.Z, Tolerance);
        }

        [Fact]
        public void AtMeanAnomalyHalfPi_PositionIsQuarterAroundOrbit()
        {
            var provider = new KeplerProvider();
            var orbit = CircularOrbit();

            // M = pi/2 at ut = pi/2.
            StateVector state = provider.Solve(orbit, Math.PI / 2.0);

            Assert.Equal(0.0, state.Position.X, Tolerance);
            Assert.Equal(1.0, state.Position.Y, Tolerance);
            Assert.Equal(0.0, state.Position.Z, Tolerance);

            Assert.Equal(-1.0, state.Velocity.X, Tolerance);
            Assert.Equal(0.0, state.Velocity.Y, Tolerance);
            Assert.Equal(0.0, state.Velocity.Z, Tolerance);
        }
    }
}
