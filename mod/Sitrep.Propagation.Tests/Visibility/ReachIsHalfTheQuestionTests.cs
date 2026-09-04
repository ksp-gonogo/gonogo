using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// A clear line of sight is only half of what a link needs. The other half
    /// is that the two ends can actually hear each other at that separation,
    /// and until the elected comms backend was asked for a reach rule this
    /// geometry did not model it at all: every prediction promised
    /// reacquisition the instant the craft cleared the limb, however far out it
    /// was.
    ///
    /// <para>That is the failure mode worth a test of its own because it is a
    /// PREDICTION an operator plans against, not a readout they can sanity-check
    /// against the game. A craft that clears Kerbin's limb 40 Gm out gets a
    /// contact window that never opens, and the silence tracker declares it
    /// reacquired on schedule.</para>
    ///
    /// <para>Reach is composed the same way the occluders already are: the worse
    /// term wins per station, the best station wins overall. So a station that
    /// can see the craft but not hear it loses to one that can do both, and a
    /// craft beyond every station's reach is dark even in plain view.</para>
    /// </summary>
    public class ReachIsHalfTheQuestionTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinSiderealDay = 21_549.425;
        private const int Kerbin = 0;

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
        };

        private static IPropagationProvider Propagator() => new KeplerProvider(System());

        /// <summary>
        /// A craft in a very high, circular, equatorial Kerbin orbit: far enough
        /// out that a real antenna budget would not close, and in the clear for
        /// most of every station-day.
        /// </summary>
        private static OrbitElements FarCraft(double semiMajorAxisMeters) =>
            new OrbitElements(semiMajorAxisMeters, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        private static RotatingGroundStation Station(double longitudeDeg) =>
            RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: longitudeDeg,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinSiderealDay,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);

        /// <summary>Every station held to the same limit, which is the stock case.</summary>
        private static OrbitToRemoteStationGeometry Geometry(
            double semiMajorAxisMeters,
            double? maxRangeMeters,
            params double[] stationLongitudesDeg)
        {
            var limits = new List<double?>();
            foreach (var _ in stationLongitudesDeg)
            {
                limits.Add(maxRangeMeters);
            }
            return GeometryPerStation(semiMajorAxisMeters, limits, stationLongitudesDeg);
        }

        private static OrbitToRemoteStationGeometry GeometryPerStation(
            double semiMajorAxisMeters,
            IEnumerable<double?> maxRangeMetersPerStation,
            params double[] stationLongitudesDeg)
        {
            var stations = new List<RotatingGroundStation>();
            foreach (var longitude in stationLongitudesDeg)
            {
                stations.Add(Station(longitude));
            }
            return new OrbitToRemoteStationGeometry(
                PropagationTarget.Vessel("farcraft", Kerbin, FarCraft(semiMajorAxisMeters)),
                PropagationFrame.CentredOn(Kerbin),
                new OccludingBody[0],
                stations,
                KerbinRadius,
                Propagator(),
                maxRangeMetersPerStation);
        }

        /// <summary>
        /// The replication. A craft 40 Gm out, directly over a station, is
        /// plainly in view: with no reach rule the margin is positive and the
        /// sweep calls it contact. A backend that says "I stop carrying this
        /// pair at 1 Gm" must turn that same instant dark.
        /// </summary>
        [Fact]
        public void AVesselInPlainViewButBeyondReachIsDark()
        {
            const double fortyGigametres = 40e9;

            var noReachRule = Geometry(fortyGigametres, null, 0.0);
            Assert.True(
                noReachRule.MarginAt(0.0) > 0.0,
                "the craft must be geometrically clear, or this test is not about reach");

            var reachesOneGigametre = Geometry(fortyGigametres, 1e9, 0.0);

            Assert.True(
                reachesOneGigametre.MarginAt(0.0) < 0.0,
                "a craft 40 Gm from a station that stops carrying at 1 Gm is out of contact, "
                + "however clear the line of sight");
        }

        /// <summary>
        /// The other side of the same coin: a reach rule the craft is well
        /// inside must not change a geometry that was already clear. A term
        /// that darkened everything would be as wrong as one that darkened
        /// nothing, and easier to miss.
        /// </summary>
        [Fact]
        public void AVesselComfortablyWithinReachIsUnaffected()
        {
            const double sma = 10e6;

            var withoutRule = Geometry(sma, null, 0.0);
            var withGenerousRule = Geometry(sma, 1e12, 0.0);

            Assert.True(withoutRule.MarginAt(0.0) > 0.0);
            Assert.True(withGenerousRule.MarginAt(0.0) > 0.0);
        }

        /// <summary>
        /// Reach cuts a station's OWN margin before the stations compete, the
        /// same place the chain occluders cut it. A station on the far side of
        /// the body cannot hear the craft either, so "best station wins" must
        /// pick one that can do both rather than combining the sight of one
        /// with the reach of another.
        /// </summary>
        [Fact]
        public void ReachCutsEachStationBeforeTheStationsCompete()
        {
            // Two stations half a world apart. At UT 0 one is under the craft
            // and one is behind the planet; a craft beyond reach is dark for
            // both, so no pairing of the two can manufacture contact.
            var beyondReach = Geometry(40e9, 1e9, 0.0, 180.0);

            Assert.True(beyondReach.MarginAt(0.0) < 0.0);
        }

        /// <summary>
        /// Reach is asked PER PAIR, so two stations on one body need not share
        /// a limit: RSS/RealAntennas fly a dozen that do not share an antenna.
        /// A craft one station cannot hear but another can is in contact, which
        /// is the same "best station wins" the horizon term already applies.
        /// </summary>
        [Fact]
        public void EachStationCarriesItsOwnReachLimit()
        {
            const double sma = 10e6;
            var separation = Geometry(sma, (double?)null, 0.0).SeparationAt(0.0);

            // Station at longitude 0 is under the craft and cannot hear it;
            // the one behind it can, but is on the far side of the planet.
            var onlyTheBlindStationReaches = GeometryPerStation(
                sma,
                new double?[] { separation * 0.5, 1e12 },
                0.0,
                180.0);
            Assert.True(
                onlyTheBlindStationReaches.MarginAt(0.0) < 0.0,
                "the station that can hear the craft cannot see it, and the one that can see it "
                + "cannot hear it: no pairing of the two is a contact");

            // Now give the station that CAN see it a limit it clears.
            var theSightedStationReaches = GeometryPerStation(
                sma,
                new double?[] { separation * 2.0, 1e12 },
                0.0,
                180.0);
            Assert.True(theSightedStationReaches.MarginAt(0.0) > 0.0);
        }

        /// <summary>
        /// A limit list shorter than the station list is a caller bug, and it
        /// must not be readable as "the rest are unbounded": that is precisely
        /// the over-promise the whole term exists to stop, and it would come
        /// back silently.
        /// </summary>
        [Fact]
        public void AShortLimitListThrowsRatherThanLeavingStationsUnbounded()
        {
            Assert.Throws<ArgumentException>(() => GeometryPerStation(
                10e6,
                new double?[] { 1e9 },
                0.0,
                180.0));
        }

        /// <summary>
        /// The margin has to be ROOT-FINDABLE, which is the contract
        /// <see cref="IVisibilityGeometry.MarginAt"/> states and the reason
        /// <see cref="ChordOcclusion.HorizonMargin"/> exists at all. A reach
        /// term expressed as metres squared crosses zero exactly at the limit
        /// and is smooth either side of it, so a bracket really does contain a
        /// crossing.
        /// </summary>
        [Fact]
        public void TheReachTermCrossesZeroAtTheLimitRatherThanJumping()
        {
            // A station directly under the craft, so the horizon term is
            // comfortably positive and the reach term is the one in play. Sweep
            // the rule's limit across the craft's actual separation and watch
            // the margin change sign once, smoothly.
            const double sma = 10e6;
            var separation = Geometry(sma, null, 0.0).SeparationAt(0.0);

            var below = Geometry(sma, separation * 0.9, 0.0).MarginAt(0.0);
            var at = Geometry(sma, separation, 0.0).MarginAt(0.0);
            var above = Geometry(sma, separation * 1.1, 0.0).MarginAt(0.0);

            Assert.True(below < 0.0, "a limit under the separation is out of reach");
            Assert.True(above > 0.0, "a limit over the separation is in reach");
            Assert.True(
                Math.Abs(at) < Math.Abs(below) && Math.Abs(at) < Math.Abs(above),
                "the margin must approach zero AT the limit rather than jumping across it");
        }
    }
}
