using System.Collections.Generic;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// Which bodies can block the path, against a miniature Kerbol: Sun(0),
    /// Kerbin(1), Mun(2), Minmus(3), Jool(4), Laythe(5).
    ///
    /// <para>This logic used to live against <c>CelestialBody</c>, so the only
    /// way to ask it a question was to launch the game, ten minutes per
    /// question, against a function whose failure mode is a plausible-looking
    /// wrong number rather than a crash.</para>
    ///
    /// <para>It used to answer with a conic per link as well. Where each of these
    /// bodies IS at a given UT is now the elected propagation provider's answer,
    /// pinned in <c>ChainWalkIsTheProvidersJobTests</c>; what is left here is the
    /// question the visibility side actually has, which is who is in the way.</para>
    /// </summary>
    public class PatchedConicChainTests
    {
        private const double SunMu = 1.1723328e18;
        private const double KerbinMu = 3.5316e12;
        private const double JoolMu = 2.82528e14;

        private const int Sun = 0, Kerbin = 1, Mun = 2, Minmus = 3, Jool = 4, Laythe = 5;

        private static readonly double[] Radii =
        {
            261_600_000.0, 600_000.0, 200_000.0, 60_000.0, 6_000_000.0, 500_000.0,
        };

        private static OrbitElements Circular(double sma, double mu) =>
            new OrbitElements(sma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, mu);

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            // The root's stored elements are NOT an orbit, exactly as KSP has it.
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Sun, Circular(13_599_840_256.0, SunMu)),
            new SystemBody(Kerbin, Circular(12_000_000.0, KerbinMu)),
            new SystemBody(Kerbin, Circular(46_400_000.0, KerbinMu)),
            new SystemBody(Sun, Circular(68_773_560_320.0, SunMu)),
            new SystemBody(Jool, Circular(27_184_000.0, JoolMu)),
        };

        private static List<OccludingBody> Between(int stationBody, int vesselParent) =>
            PatchedConicChain.OccludersBetween(stationBody, vesselParent, System(), i => Radii[i]);

        [Fact]
        public void SameBodyHasNothingInTheWay()
        {
            Assert.Empty(Between(Kerbin, Kerbin));
        }

        [Fact]
        public void AMoonOfTheStationsPlanetIsTheOneOccluder()
        {
            var occluders = Between(Kerbin, Minmus);

            Assert.Single(occluders);
            Assert.Equal(Minmus, occluders[0].BodyIndex);
            Assert.Equal(60_000.0, occluders[0].OccludingRadiusMeters);
        }

        /// <summary>
        /// The case that was silently broken live. Climbing to the star puts the
        /// STAR in the way, not the planet being left behind.
        /// </summary>
        [Fact]
        public void ASolarOrbitIsBlockedByTheStarRatherThanByThePlanetLeftBehind()
        {
            var occluders = Between(Kerbin, Sun);

            Assert.Single(occluders);
            Assert.Equal(Sun, occluders[0].BodyIndex);
            Assert.Equal(261_600_000.0, occluders[0].OccludingRadiusMeters);
        }

        [Fact]
        public void AMoonOfAnotherPlanetClimbsThenDescendsTwice()
        {
            var occluders = Between(Kerbin, Laythe);

            Assert.Equal(3, occluders.Count);
            Assert.Equal(Sun, occluders[0].BodyIndex);
            Assert.Equal(Jool, occluders[1].BodyIndex);
            Assert.Equal(Laythe, occluders[2].BodyIndex);
        }

        [Fact]
        public void TheWalkIsNotSymmetricButBothDirectionsResolve()
        {
            Assert.Equal(3, Between(Kerbin, Laythe).Count);
            Assert.Equal(3, Between(Laythe, Kerbin).Count);
        }

        /// <summary>
        /// The occluding radius comes from the caller's own lookup rather than
        /// from the body table, because how big a body is to a radio wave is the
        /// elected occlusion model's answer: stock CommNet shrinks it and a
        /// network-replacing backend need not.
        /// </summary>
        [Fact]
        public void TheRadiusIsWhateverTheCallersOcclusionModelSays()
        {
            var stock = PatchedConicChain.OccludersBetween(
                Kerbin, Minmus, System(), i => Radii[i] * 0.9);

            Assert.Equal(54_000.0, stock![0].OccludingRadiusMeters);
        }

        [Fact]
        public void AnOutOfRangeIndexYieldsNoPathRatherThanThrowing()
        {
            Assert.Null(Between(-1, Kerbin));
            Assert.Null(Between(Kerbin, 99));
            Assert.Null(PatchedConicChain.OccludersBetween(Kerbin, Minmus, null, i => Radii[i]));
        }

        [Fact]
        public void ALoopedHierarchyYieldsNoPathRatherThanHanging()
        {
            var looped = new[]
            {
                new SystemBody(1, Circular(1.0, 1.0)),
                new SystemBody(0, Circular(1.0, 1.0)),
            };

            Assert.Null(PatchedConicChain.OccludersBetween(0, 1, looped, _ => 1.0));
        }
    }
}
