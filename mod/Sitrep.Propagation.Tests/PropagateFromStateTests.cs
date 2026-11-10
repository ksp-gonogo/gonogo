using System;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// The closed-form answer to propagate-from-state: the conic through the seed,
    /// the same whichever certification is asked for.
    /// </summary>
    public class PropagateFromStateTests
    {
        private const double Mu = 3.5316e12;

        private static readonly KeplerProvider Provider = new KeplerProvider();

        public static TheoryData<OrbitElements> Orbits => new TheoryData<OrbitElements>
        {
            new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.4, 100.0, Mu),
            new OrbitElements(1_500_000.0, 0.3, 0.5, 1.1, 2.2, 3.3, 100.0, Mu),
            new OrbitElements(5_000_000.0, 0.7, 2.6, 4.0, 5.5, 0.1, 100.0, Mu),
            new OrbitElements(-2_000_000.0, 1.4, 0.3, 0.7, 1.9, 0.5, 100.0, Mu),
        };

        [Theory]
        [MemberData(nameof(Orbits))]
        public void ThePathRetracesTheOrbitTheSeedLiesOn(OrbitElements orbit)
        {
            var target = PropagationTarget.Vessel("craft", 1, orbit);
            var seed = new PropagationSeed(Provider.Solve(target, 100.0), 1, 100.0, Mu);

            var path = Provider.PropagateFromState(seed, 1100.0, 11, PropagationCertification.CertifiedOnly);

            Assert.True(path.Solved);
            Assert.Equal(11, path.States.Count);
            foreach (var point in path.States)
            {
                var expected = Provider.Solve(target, point.Ut).Position;
                var off = new Vector3d(point.X - expected.X, point.Y - expected.Y, point.Z - expected.Z);
                Assert.True(off.Magnitude() < 1e-3, "off by " + off.Magnitude() + " m at " + point.Ut);
            }
        }

        [Fact]
        public void BothCertificationsGetTheSameAnswerAndItSaysItIsAConic()
        {
            var seed = new PropagationSeed(
                new StateVector(new Vector3d(700_000.0, 0.0, 0.0), new Vector3d(0.0, 2246.0, 0.0)), 1, 0.0, Mu);

            var accurate = Provider.PropagateFromState(seed, 600.0, 4, PropagationCertification.CertifiedOnly);
            var analytic = Provider.PropagateFromState(seed, 600.0, 4, PropagationCertification.Unbounded);

            Assert.Equal(TrajectoryKind.Analytic, accurate.Kind);
            Assert.Equal(accurate.Kind, analytic.Kind);
            Assert.Equal(600.0, accurate.ReachedUt);
            for (var i = 0; i < 4; i++)
            {
                Assert.Equal(accurate.States[i].X, analytic.States[i].X);
                Assert.Equal(accurate.States[i].Y, analytic.States[i].Y);
            }
        }

        [Fact]
        public void ThePathBeginsAtTheSeedAndEndsWhereAsked()
        {
            var seed = new PropagationSeed(
                new StateVector(new Vector3d(700_000.0, 0.0, 0.0), new Vector3d(0.0, 2246.0, 0.0)), 1, 50.0, Mu);

            var path = Provider.PropagateFromState(seed, 650.0, 0, PropagationCertification.CertifiedOnly);

            Assert.Equal(PropagatedPath.DefaultPoints, path.States.Count);
            Assert.Equal(50.0, path.States[0].Ut);
            Assert.Equal(650.0, path.States[path.States.Count - 1].Ut);
            Assert.Equal(1, path.CentreBodyIndex);
        }

        [Fact]
        public void ANonsenseAskIsRefusedRatherThanAnswered()
        {
            var good = new StateVector(new Vector3d(700_000.0, 0.0, 0.0), new Vector3d(0.0, 2246.0, 0.0));
            var radial = new StateVector(new Vector3d(700_000.0, 0.0, 0.0), new Vector3d(100.0, 0.0, 0.0));

            AssertRefused(new PropagationSeed(good, 1, 100.0, Mu), 100.0);
            AssertRefused(new PropagationSeed(good, 1, 100.0, Mu), 50.0);
            AssertRefused(new PropagationSeed(good, 1, 100.0, 0.0), 200.0);
            AssertRefused(new PropagationSeed(radial, 1, 100.0, Mu), 200.0);
            AssertRefused(new PropagationSeed(new StateVector(default, default), 1, 100.0, Mu), 200.0);
        }

        [Theory]
        [MemberData(nameof(Orbits))]
        public void TheClosedFormProviderMeetsTheSharedConformanceAssertion(OrbitElements orbit)
        {
            var target = PropagationTarget.Vessel("craft", 1, orbit);
            var seed = new PropagationSeed(Provider.Solve(target, 100.0), 1, 100.0, Mu);

            PropagationFromStateConformance.AssertPropagationFromStateContract(Provider, seed, 1100.0);
        }

        [Fact]
        public void TheConformanceAssertionRefusesAProviderThatAnswersAnEmptySpan()
        {
            var seed = new PropagationSeed(
                new StateVector(new Vector3d(700_000.0, 0.0, 0.0), new Vector3d(0.0, 2246.0, 0.0)), 1, 0.0, Mu);

            Assert.ThrowsAny<Exception>(() =>
                PropagationFromStateConformance.AssertPropagationFromStateContract(new AlwaysSolves(), seed, 600.0));
        }

        private sealed class AlwaysSolves : IPropagationFromState
        {
            public PropagatedPath PropagateFromState(
                PropagationSeed seed, double toUt, int maxPoints, PropagationCertification certification) =>
                Provider.PropagateFromState(seed, seed.Ut + 600.0, maxPoints, certification);
        }

        private static void AssertRefused(PropagationSeed seed, double toUt)
        {
            var path = Provider.PropagateFromState(seed, toUt, 8, PropagationCertification.CertifiedOnly);
            Assert.False(path.Solved);
            Assert.Empty(path.States);
            Assert.Equal(TrajectoryKind.Unspecified, path.Kind);
            Assert.False(string.IsNullOrEmpty(path.Refusal));
        }
    }
}
