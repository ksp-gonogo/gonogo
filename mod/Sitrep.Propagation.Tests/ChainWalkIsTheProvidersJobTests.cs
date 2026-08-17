using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// Reaching a frame centred on some OTHER body than the one a target orbits is
    /// the PROVIDER's job, not the caller's.
    ///
    /// <para>It used to be the caller's: the visibility geometry held a list of
    /// conics and a direction flag per link, and summed them itself. That put the
    /// two-body assumption in the one place the seam could not reach, and it left
    /// the sign of each link as something a caller could state wrongly. Here the
    /// caller states only WHAT it wants and WHERE it wants it expressed, and how the
    /// answer is reached is the implementation's business.</para>
    ///
    /// <para>Every expected value below is computed from single-body solves
    /// combined by hand, so these check the walk against arithmetic rather than
    /// against a restatement of the walk.</para>
    /// </summary>
    public class ChainWalkIsTheProvidersJobTests
    {
        private const double SunMu = 1.1723328e18;
        private const double KerbinMu = 3.5316e12;
        private const double JoolMu = 2.82528e14;

        private const int Sun = 0, Kerbin = 1, Mun = 2, Minmus = 3, Jool = 4, Laythe = 5;

        private static OrbitElements Circular(double sma, double mu, double meanAnomaly = 0.0) =>
            new OrbitElements(sma, 0.0, 0.0, 0.0, 0.0, meanAnomaly, 0.0, mu);

        private static OrbitElements KerbinAboutSun() => Circular(13_599_840_256.0, SunMu, 0.4);

        private static OrbitElements MunAboutKerbin() => Circular(12_000_000.0, KerbinMu, 1.1);

        private static OrbitElements MinmusAboutKerbin() => Circular(46_400_000.0, KerbinMu, 2.3);

        private static OrbitElements JoolAboutSun() => Circular(68_773_560_320.0, SunMu, 3.0);

        private static OrbitElements LaytheAboutJool() => Circular(27_184_000.0, JoolMu, 0.7);

        /// <summary>The root's stored elements are NOT an orbit, exactly as KSP has it.</summary>
        private static IReadOnlyList<SystemBody> Kerbol() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Sun, KerbinAboutSun()),
            new SystemBody(Kerbin, MunAboutKerbin()),
            new SystemBody(Kerbin, MinmusAboutKerbin()),
            new SystemBody(Sun, JoolAboutSun()),
            new SystemBody(Jool, LaytheAboutJool()),
        };

        private static IPropagationProvider Provider() => new KeplerProvider(Kerbol());

        private static PropagationTarget Vessel(OrbitElements orbit, int parent) =>
            PropagationTarget.Vessel("vessel-guid", parent, orbit);

        private static void AssertSame(Vector3d expected, Vector3d actual, double toleranceMeters = 1e-3)
        {
            Assert.InRange((expected - actual).Magnitude(), 0.0, toleranceMeters);
        }

        [Fact]
        public void DescendingOneLinkAddsTheParentsOwnPosition()
        {
            // A craft at Minmus asked for in the Kerbin frame. Described by its
            // Minmus-relative elements alone it sits 46,400 km from where it is.
            var provider = Provider();
            var craft = Circular(120_000.0, 1.7658e9);
            var ut = 6_411.0;

            var actual = provider.Solve(Vessel(craft, Minmus), PropagationFrame.CentredOn(Kerbin), ut).Position;

            var expected = provider.SolveConic(MinmusAboutKerbin(), ut).Position
                + provider.SolveConic(craft, ut).Position;
            AssertSame(expected, actual);
        }

        /// <summary>
        /// The sign that used to be a caller's to state, and so a caller's to get
        /// wrong. Climbing SUBTRACTS: the frame sits on the far side of the body
        /// being climbed past. Adding instead is wrong by twice Kerbin's orbital
        /// radius, which is a plausible-looking number in the wrong place.
        /// </summary>
        [Fact]
        public void ClimbingToTheStarSubtractsRatherThanAdding()
        {
            var provider = Provider();
            var craft = Circular(13_599_840_256.0 * 2.0, SunMu, 1.9);
            var ut = 90_000.0;

            var actual = provider.Solve(Vessel(craft, Sun), PropagationFrame.CentredOn(Kerbin), ut).Position;

            var craftAboutSun = provider.SolveConic(craft, ut).Position;
            var kerbinAboutSun = provider.SolveConic(KerbinAboutSun(), ut).Position;
            AssertSame(craftAboutSun - kerbinAboutSun, actual);

            var wrongSign = craftAboutSun + kerbinAboutSun;
            Assert.True(
                (wrongSign - actual).Magnitude() > 13_599_840_256.0,
                "adding the ascending link must be wrong by order Kerbin's orbital radius");
        }

        [Fact]
        public void AMoonOfAnotherPlanetClimbsThenDescendsTwice()
        {
            var provider = Provider();
            var craft = Circular(600_000.0, 1.962e12, 0.3);
            var ut = 41_000.0;

            var actual = provider.Solve(Vessel(craft, Laythe), PropagationFrame.CentredOn(Kerbin), ut).Position;

            var expected = provider.SolveConic(JoolAboutSun(), ut).Position
                + provider.SolveConic(LaytheAboutJool(), ut).Position
                + provider.SolveConic(craft, ut).Position
                - provider.SolveConic(KerbinAboutSun(), ut).Position;
            AssertSame(expected, actual);
        }

        [Fact]
        public void VelocityIsComposedTheSameWayAsPosition()
        {
            // The occlusion pass only reads positions, so a velocity left at the
            // target's parent-relative value would go unnoticed until something
            // else asked. Both halves of the state vector are the sum of the same
            // links.
            var provider = Provider();
            var craft = Circular(120_000.0, 1.7658e9, 0.8);
            var ut = 2_222.0;

            var actual = provider.Solve(Vessel(craft, Minmus), PropagationFrame.CentredOn(Kerbin), ut).Velocity;

            var expected = provider.SolveConic(MinmusAboutKerbin(), ut).Velocity
                + provider.SolveConic(craft, ut).Velocity;
            AssertSame(expected, actual, 1e-6);
        }

        [Fact]
        public void ABodyIsNamedRatherThanDescribed()
        {
            // A body target carries no elements at all: the provider resolves it
            // against its own table. That is what lets the occlusion pass ask where
            // each occluder is without holding a conic for any of them.
            var provider = Provider();
            var ut = 15_000.0;

            var minmus = provider.Solve(
                PropagationTarget.Body(Minmus), PropagationFrame.CentredOn(Kerbin), ut).Position;
            var sun = provider.Solve(
                PropagationTarget.Body(Sun), PropagationFrame.CentredOn(Kerbin), ut).Position;

            AssertSame(provider.SolveConic(MinmusAboutKerbin(), ut).Position, minmus);
            AssertSame(new Vector3d(0, 0, 0) - provider.SolveConic(KerbinAboutSun(), ut).Position, sun);
        }

        [Fact]
        public void ABodyInItsOwnFrameSitsAtTheOrigin()
        {
            var position = Provider().Solve(
                PropagationTarget.Body(Kerbin), PropagationFrame.CentredOn(Kerbin), 700.0).Position;

            AssertSame(new Vector3d(0, 0, 0), position);
        }

        [Fact]
        public void WithoutASystemTableAForeignFrameIsRefusedRatherThanApproximated()
        {
            // The refusal that was already here, and it must survive the walk
            // moving inside: a provider with no map of the system cannot reach
            // another body's frame, and returning the parent-relative vector anyway
            // is the "plausible number in the wrong place" failure this subsystem
            // has been bitten by twice.
            IPropagationProvider provider = new KeplerProvider();
            var target = Vessel(Circular(700_000.0, KerbinMu), Kerbin);

            Assert.False(provider.CanPropagate(target, PropagationFrame.CentredOn(Mun), 0.0, 100.0));
            Assert.Throws<NotSupportedException>(
                () => provider.Solve(target, PropagationFrame.CentredOn(Mun), 0.0));
        }

        [Fact]
        public void WithoutASystemTableABodyCannotBeResolvedAtAll()
        {
            IPropagationProvider provider = new KeplerProvider();

            Assert.False(provider.CanPropagate(
                PropagationTarget.Body(Minmus), PropagationFrame.CentredOn(Kerbin), 0.0, 100.0));
        }

        [Fact]
        public void ATargetsOwnParentFrameNeedsNoTable()
        {
            // The overwhelmingly common ask, and the one that must keep working for
            // a provider constructed with nothing: the elements already describe
            // the answer.
            IPropagationProvider provider = new KeplerProvider();
            var target = Vessel(Circular(700_000.0, KerbinMu), Kerbin);

            Assert.True(provider.CanPropagate(target, PropagationFrame.CentredOn(Kerbin), 0.0, 100.0));
        }

        [Fact]
        public void ALinkThatIsNotABoundConicIsRefusedRatherThanThrownDeepInTheSweep()
        {
            // KSP gives the Sun ecc = 1 and sma = 0, so any path that tries to walk
            // THROUGH the root reaches a non-orbit. Refusing here is what stops the
            // solver throwing inside the sweep, where the policy swallows it and the
            // predictor goes silent with no trace.
            var broken = new[]
            {
                new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
                new SystemBody(0, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
                new SystemBody(0, Circular(46_400_000.0, KerbinMu)),
            };
            IPropagationProvider provider = new KeplerProvider(broken);

            Assert.False(provider.CanPropagate(
                PropagationTarget.Vessel("v", 2, Circular(120_000.0, 1.7658e9)),
                PropagationFrame.CentredOn(1),
                0.0,
                100.0));
        }

        [Fact]
        public void AChainThroughTheRootIsFineBecauseTheRootIsNeverALink()
        {
            // Kerbin's and Jool's own orbits ARE elliptical. The Sun's non-orbit is
            // only ever the body a path passes THROUGH, never one whose elements
            // get solved.
            Assert.True(Provider().CanPropagate(
                PropagationTarget.Vessel("v", Laythe, Circular(600_000.0, 1.962e12)),
                PropagationFrame.CentredOn(Kerbin),
                0.0,
                86_400.0));
        }

        [Fact]
        public void ALoopedHierarchyIsRefusedRatherThanHanging()
        {
            var looped = new[]
            {
                new SystemBody(1, Circular(1.0, 1.0)),
                new SystemBody(0, Circular(1.0, 1.0)),
            };
            IPropagationProvider provider = new KeplerProvider(looped);

            Assert.False(provider.CanPropagate(
                PropagationTarget.Body(1), PropagationFrame.CentredOn(0), 0.0, 1.0));
        }

        [Fact]
        public void AnOutOfRangeIndexIsRefusedRatherThanThrowing()
        {
            var provider = Provider();

            Assert.False(provider.CanPropagate(
                PropagationTarget.Body(99), PropagationFrame.CentredOn(Kerbin), 0.0, 1.0));
            Assert.False(provider.CanPropagate(
                PropagationTarget.Vessel("v", Kerbin, Circular(700_000.0, KerbinMu)),
                PropagationFrame.CentredOn(99),
                0.0,
                1.0));
        }

        [Fact]
        public void SolveManyWalksTheChainForEverySample()
        {
            var provider = Provider();
            var target = Vessel(Circular(120_000.0, 1.7658e9), Minmus);
            var frame = PropagationFrame.CentredOn(Kerbin);
            var uts = new List<double>();
            for (var i = 0; i < 32; i++) uts.Add(i * 61.0);

            var batched = new StateVector[uts.Count];
            provider.SolveMany(target, frame, uts, batched);

            for (var i = 0; i < uts.Count; i++)
            {
                AssertSame(provider.Solve(target, frame, uts[i]).Position, batched[i].Position);
            }
        }
    }
}
