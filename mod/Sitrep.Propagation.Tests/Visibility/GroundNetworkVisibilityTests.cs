using System;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// A craft behind a moon should be reckoned back when it clears the moon,
    /// not when one particular ground station happens to rotate into view.
    ///
    /// <para>Measured live on 2026-08-16: a relay in a circular 20 km orbit
    /// about Minmus was predicted to be silent for 2104 s and was actually
    /// silent for 795 s. 795 s is what the moon's own shadow gives
    /// (<c>2*asin(60/80)</c> of a 3383.6 s period is 913 s, and a chord that
    /// misses the shadow's centre is shorter still). No single sphere can block
    /// 62% of a circular orbit, so the extra 1310 s came from the other
    /// occluder in the sweep: the station's own planet, which hides the craft
    /// below ONE station's horizon for hours.</para>
    ///
    /// <para>A real network does not go blind that way. KSP had thirteen home
    /// nodes live at the time; while one faces away another faces the craft.
    /// Modelling the ground segment as a single point on a rotating sphere
    /// invents a blackout the network never has, and it errs LATE, the
    /// direction that delays every overdue and lost declaration.</para>
    /// </summary>
    public class GroundNetworkVisibilityTests
    {
        private const double KerbinRadius = 600_000.0;
        private const double KerbinSiderealDay = 21_549.425;
        private const double MinmusMu = 1_765_800_026.3;
        private const double MinmusRadius = 60_000.0;
        private const double MinmusSma = 46_400_000.0;
        private const double KerbinMu = 3.5316e12;

        /// <summary>The live case: circular, 20 km above Minmus.</summary>
        private static OrbitElements Relay() =>
            new OrbitElements(79_999.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, MinmusMu);

        private static OrbitToRemoteStationGeometry.ChainLink MinmusLink() =>
            new OrbitToRemoteStationGeometry.ChainLink(
                new OrbitElements(MinmusSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu),
                MinmusRadius,
                descending: true);

        private static RotatingGroundStation StationAt(double longitudeDegrees) =>
            RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: longitudeDegrees,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinSiderealDay,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);

        /// <summary>
        /// How long the path stays blocked from first loss, stepping finely
        /// enough to resolve the moon's own ingress and egress.
        /// </summary>
        private static double BlackoutSeconds(IVisibilityGeometry geometry, double period)
        {
            var step = period / 2000.0;
            double? lossAt = null;
            for (var i = 0; i < 8000; i++)
            {
                var t = i * step;
                var blocked = geometry.MarginAt(t) < 0.0;
                if (blocked && lossAt == null) lossAt = t;
                if (!blocked && lossAt != null) return t - lossAt.Value;
            }
            return double.PositiveInfinity;
        }

        /// <summary>
        /// Stations spread around the planet: the craft is in contact whenever
        /// ANY of them can see it, so the only thing that can hide it is the
        /// moon.
        /// </summary>
        [Fact]
        public void AGroundNetworkSeesTheCraftBackWhenItClearsTheMoon()
        {
            var stations = new[] { StationAt(0.0), StationAt(120.0), StationAt(240.0) };
            var geometry = new OrbitToRemoteStationGeometry(
                Relay(), new[] { MinmusLink() }, stations, KerbinRadius);

            var blackout = BlackoutSeconds(geometry, geometry.PeriodSeconds);

            // The moon's shadow and nothing else: 913 s is the widest chord, and
            // the live measurement was 795 s.
            Assert.InRange(blackout, 400.0, 1000.0);
        }

        /// <summary>
        /// The old single-station behaviour, kept as a witness. One station
        /// alone really is blind for hours, which is why the predictor ran long.
        /// </summary>
        [Fact]
        public void ASingleStationInventsABlackoutTheNetworkNeverHas()
        {
            var geometry = new OrbitToRemoteStationGeometry(
                Relay(), new[] { MinmusLink() }, new[] { StationAt(180.0) }, KerbinRadius);

            var blackout = BlackoutSeconds(geometry, geometry.PeriodSeconds);

            Assert.True(blackout > 1500.0,
                "one station should show the long phantom outage; got " + blackout);
        }

        [Fact]
        public void AnEmptyStationSetIsRejectedRatherThanSilentlySeeingNothing()
        {
            Assert.Throws<ArgumentException>(() => new OrbitToRemoteStationGeometry(
                Relay(), new[] { MinmusLink() }, new RotatingGroundStation[0], KerbinRadius));
        }
    }
}
