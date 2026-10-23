using System;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// A craft inside a body's sphere of influence on an escape path is on a hyperbola
    /// until the game changes its patch, and is as much a place the craft is as any
    /// closed orbit. The provider follows it for as long as its elements are valid.
    /// </summary>
    public class HyperbolicOrbitTests
    {
        private const double Mu = 1.7658e9;

        private static OrbitElements Escape(double meanAnomaly) =>
            new OrbitElements(sma: -400_000.0, ecc: 1.8, inc: 0.3, lan: 0.7, argPe: 1.1, meanAnomalyAtEpoch: meanAnomaly, epoch: 0.0, mu: Mu);

        [Fact]
        public void AnEscapePathIsOneTheProviderCanFollow()
        {
            IPropagationProvider provider = new KeplerProvider();

            Assert.True(provider.CanPropagate(ThroughTheSeam.Craft(Escape(-1.0)), 0.0, 100_000.0));
        }

        [Fact]
        public void AtPeriapsisTheCraftSitsAtTheClosestRadiusMovingAtTheEscapePathsSpeed()
        {
            IPropagationProvider provider = new KeplerProvider();
            var orbit = Escape(0.0);

            var state = provider.SolveConic(orbit, 0.0);

            var periapsis = 400_000.0 * 0.8;
            Assert.Equal(periapsis, state.Position.Magnitude(), 3);
            var visViva = Math.Sqrt(Mu * ((2.0 / periapsis) + (1.0 / -orbit.Sma)));
            Assert.Equal(visViva, state.Velocity.Magnitude(), 3);
        }

        [Theory]
        [InlineData(-2.0)]
        [InlineData(0.0)]
        [InlineData(0.4)]
        public void TheCraftKeepsItsEnergyAndAngularMomentumAlongTheEscapePath(double meanAnomaly)
        {
            IPropagationProvider provider = new KeplerProvider();
            var orbit = Escape(meanAnomaly);
            var first = provider.SolveConic(orbit, 0.0);
            var later = provider.SolveConic(orbit, 2_500.0);

            Assert.Equal(Energy(first), Energy(later), 6);
            Assert.Equal(Momentum(first), Momentum(later), 0);
            Assert.True(later.Position.Magnitude() > 0.0);
        }

        private static double Energy(StateVector s) =>
            (0.5 * s.Velocity.MagnitudeSquared()) - (Mu / s.Position.Magnitude());

        private static double Momentum(StateVector s)
        {
            var p = s.Position;
            var v = s.Velocity;
            var h = new Vector3d((p.Y * v.Z) - (p.Z * v.Y), (p.Z * v.X) - (p.X * v.Z), (p.X * v.Y) - (p.Y * v.X));
            return h.Magnitude();
        }
    }
}
