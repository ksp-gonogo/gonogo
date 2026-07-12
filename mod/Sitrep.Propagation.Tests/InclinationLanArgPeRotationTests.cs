using System;
using Xunit;
using Sitrep.Propagation;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// Nonzero inc/lan/argPe case, verified by rotation INVARIANTS rather
    /// than a re-derivation of the rotation matrix itself (which would just
    /// duplicate <see cref="KeplerProvider"/>'s own arithmetic):
    ///
    /// 1. Rotating position/velocity into the inertial frame is a pure
    ///    rotation (orthogonal transform) -- magnitudes must be unchanged
    ///    from the equivalent unrotated (inc=lan=argPe=0) orbit.
    /// 2. The orbital-plane normal (position x velocity, i.e. specific
    ///    angular momentum direction) must match inc/lan via the standard,
    ///    independently-known relations:
    ///      cos(inc) = h_z / |h|
    ///      lan      = atan2(h_x, -h_y)
    ///    (the ascending-node-vector identity: N = k x h = (-h_y, h_x, 0),
    ///    so lan = atan2(N_y, N_x) = atan2(h_x, -h_y)). These are textbook
    ///    orbital-mechanics formulas, not anything read out of
    ///    <see cref="KeplerProvider"/>'s rotation code -- so this is an
    ///    independent check on the rotation, not a tautology.
    /// </summary>
    public class InclinationLanArgPeRotationTests
    {
        private const double AngleTolerance = 1e-9;

        private static OrbitElements TiltedCircularOrbit(double inc, double lan, double argPe)
        {
            return new OrbitElements(
                sma: 1.0,
                ecc: 0.0,
                inc: inc,
                lan: lan,
                argPe: argPe,
                meanAnomalyAtEpoch: 0.0,
                epoch: 0.0,
                mu: 1.0);
        }

        [Theory]
        [InlineData(Math.PI / 4.0, Math.PI / 6.0, Math.PI / 3.0)]
        [InlineData(Math.PI / 3.0, 0.0, Math.PI / 2.0)]
        [InlineData(0.9, 2.5, 1.1)]
        public void RotationPreservesPositionAndVelocityMagnitude(double inc, double lan, double argPe)
        {
            var provider = new KeplerProvider();
            var orbit = TiltedCircularOrbit(inc, lan, argPe);
            double expectedSpeed = Math.Sqrt(orbit.Mu / orbit.Sma);

            foreach (double ut in new[] { 0.0, 0.8, 2.1, Math.PI, 5.0 })
            {
                StateVector state = provider.Solve(orbit, ut);

                Assert.Equal(orbit.Sma, state.Position.Magnitude(), 9);
                Assert.Equal(expectedSpeed, state.Velocity.Magnitude(), 9);
            }
        }

        [Theory]
        [InlineData(Math.PI / 4.0, Math.PI / 6.0, Math.PI / 3.0)]
        [InlineData(Math.PI / 3.0, 0.3, Math.PI / 2.0)]
        [InlineData(0.9, 2.5, 1.1)]
        [InlineData(1.7, 5.5, 0.0)]
        public void OrbitNormalDirectionMatchesInclinationAndLan(double inc, double lan, double argPe)
        {
            var provider = new KeplerProvider();
            var orbit = TiltedCircularOrbit(inc, lan, argPe);

            StateVector state = provider.Solve(orbit, 1.3);

            Vector3d h = Cross(state.Position, state.Velocity);
            double hMagnitude = h.Magnitude();

            double computedInc = Math.Acos(Clamp(h.Z / hMagnitude, -1.0, 1.0));
            double computedLan = WrapTwoPi(Math.Atan2(h.X, -h.Y));

            Assert.Equal(inc, computedInc, AngleTolerance);
            Assert.Equal(WrapTwoPi(lan), computedLan, AngleTolerance);
        }

        private static Vector3d Cross(Vector3d a, Vector3d b)
        {
            return new Vector3d(
                a.Y * b.Z - a.Z * b.Y,
                a.Z * b.X - a.X * b.Z,
                a.X * b.Y - a.Y * b.X);
        }

        private static double Clamp(double value, double min, double max)
        {
            return value < min ? min : (value > max ? max : value);
        }

        private static double WrapTwoPi(double angle)
        {
            double twoPi = 2.0 * Math.PI;
            double wrapped = angle % twoPi;
            if (wrapped < 0)
            {
                wrapped += twoPi;
            }

            return wrapped;
        }
    }
}
