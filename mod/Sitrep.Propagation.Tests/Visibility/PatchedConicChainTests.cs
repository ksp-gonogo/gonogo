using System.Collections.Generic;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// The chain walk, against a miniature Kerbol: Sun(0), Kerbin(1),
    /// Mun(2), Minmus(3), Jool(4), Laythe(5).
    ///
    /// <para>This logic used to live against <c>CelestialBody</c>, so the only
    /// way to ask it a question was to launch the game — ten minutes per
    /// question, against a function whose failure mode is a plausible-looking
    /// wrong number rather than a crash.</para>
    /// </summary>
    public class PatchedConicChainTests
    {
        private const double SunMu = 1.1723328e18;
        private const double KerbinMu = 3.5316e12;
        private const double JoolMu = 2.82528e14;

        private const int Sun = 0, Kerbin = 1, Mun = 2, Minmus = 3, Jool = 4, Laythe = 5;

        private static OrbitElements Circular(double sma, double mu) =>
            new OrbitElements(sma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, mu);

        private static IReadOnlyList<ChainBody> System() => new[]
        {
            // The root's stored elements are NOT an orbit, exactly as KSP has it.
            new ChainBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0), 261_600_000.0),
            new ChainBody(Sun, Circular(13_599_840_256.0, SunMu), 600_000.0),
            new ChainBody(Kerbin, Circular(12_000_000.0, KerbinMu), 200_000.0),
            new ChainBody(Kerbin, Circular(46_400_000.0, KerbinMu), 60_000.0),
            new ChainBody(Sun, Circular(68_773_560_320.0, SunMu), 6_000_000.0),
            new ChainBody(Jool, Circular(27_184_000.0, JoolMu), 500_000.0),
        };

        [Fact]
        public void SameBodyNeedsNoLinks()
        {
            Assert.Empty(PatchedConicChain.Between(Kerbin, Kerbin, System()));
        }

        [Fact]
        public void AMoonOfTheStationsPlanetIsOneDescendingLink()
        {
            var links = PatchedConicChain.Between(Kerbin, Minmus, System());

            Assert.Single(links);
            Assert.True(links[0].Descending);
            Assert.Equal(46_400_000.0, links[0].Orbit.Sma);
            Assert.Equal(60_000.0, links[0].OccludingRadiusMeters);
        }

        /// <summary>
        /// The case that was silently broken live. Climbing to the star is an
        /// ASCENDING link, and the occluder it arrives at is the star, not the
        /// planet being left behind.
        /// </summary>
        [Fact]
        public void ASolarOrbitIsOneAscendingLinkArrivingAtTheStar()
        {
            var links = PatchedConicChain.Between(Kerbin, Sun, System());

            Assert.Single(links);
            Assert.False(links[0].Descending);
            Assert.Equal(13_599_840_256.0, links[0].Orbit.Sma);
            Assert.Equal(261_600_000.0, links[0].OccludingRadiusMeters);
        }

        [Fact]
        public void AMoonOfAnotherPlanetClimbsThenDescendsTwice()
        {
            var links = PatchedConicChain.Between(Kerbin, Laythe, System());

            Assert.Equal(3, links.Count);
            Assert.False(links[0].Descending);
            Assert.Equal(13_599_840_256.0, links[0].Orbit.Sma);
            Assert.True(links[1].Descending);
            Assert.Equal(68_773_560_320.0, links[1].Orbit.Sma);
            Assert.True(links[2].Descending);
            Assert.Equal(27_184_000.0, links[2].Orbit.Sma);
        }

        [Fact]
        public void TheWalkIsNotSymmetricButBothDirectionsResolve()
        {
            Assert.Equal(3, PatchedConicChain.Between(Kerbin, Laythe, System()).Count);
            Assert.Equal(3, PatchedConicChain.Between(Laythe, Kerbin, System()).Count);
        }

        /// <summary>
        /// Any chain through the root carries the root's non-orbit, which a
        /// Kepler solver cannot take. Detecting that here is what stops it
        /// throwing deep inside the sweep, where the policy swallows it and the
        /// predictor goes silent with no trace.
        /// </summary>
        [Fact]
        public void AChainThroughTheRootIsNotPropagatable()
        {
            var viaRoot = PatchedConicChain.Between(Kerbin, Laythe, System());
            var withinOneSystem = PatchedConicChain.Between(Kerbin, Minmus, System());

            Assert.True(PatchedConicChain.IsPropagatable(withinOneSystem));
            // Kerbin's and Jool's own orbits ARE elliptical, so a chain through
            // the Sun is propagatable; the Sun's own non-orbit is never a LINK,
            // only ever the body a link arrives at.
            Assert.True(PatchedConicChain.IsPropagatable(viaRoot));
        }

        [Fact]
        public void ANonElliptialLinkIsRejected()
        {
            var bad = new[]
            {
                new OrbitToRemoteStationGeometry.ChainLink(
                    new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0), 1.0, descending: true),
            };

            Assert.False(PatchedConicChain.IsPropagatable(bad));
        }

        [Fact]
        public void AnOutOfRangeIndexYieldsNoChainRatherThanThrowing()
        {
            Assert.Null(PatchedConicChain.Between(-1, Kerbin, System()));
            Assert.Null(PatchedConicChain.Between(Kerbin, 99, System()));
            Assert.Null(PatchedConicChain.Between(Kerbin, Minmus, null));
        }

        [Fact]
        public void ALoopedHierarchyYieldsNoChainRatherThanHanging()
        {
            var looped = new[]
            {
                new ChainBody(1, Circular(1.0, 1.0), 1.0),
                new ChainBody(0, Circular(1.0, 1.0), 1.0),
            };

            Assert.Null(PatchedConicChain.Between(0, 1, looped));
        }
    }
}
