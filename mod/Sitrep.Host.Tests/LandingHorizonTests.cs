using System;
using System.Linq;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The geometry of the horizon profile on <c>vessel.landing</c>: the bearings and
    /// ranges it reads, the angles it reports, and the cost ceiling on its reads.
    /// </summary>
    public class LandingHorizonTests
    {
        private const double MunRadius = 200_000.0;

        [Fact]
        public void TheProfileAlwaysAsksForTheSameBoundedNumberOfReads()
        {
            var reads = 0;
            LandingHorizon.Profile((_, _) => { reads++; return 0.0; }, 500.0, MunRadius, 5_000.0);
            Assert.Equal(LandingHorizon.AzimuthCount * LandingHorizon.RangeSamples, reads);
        }

        [Fact]
        public void TheRangesRunFromTheNearestReadToTheLimitInOrder()
        {
            var ranges = LandingHorizon.Ranges(12_000.0);
            Assert.Equal(LandingHorizon.MinRangeMeters, ranges[0], 6);
            Assert.Equal(12_000.0, ranges[ranges.Length - 1], 3);
            Assert.True(ranges.Zip(ranges.Skip(1), (a, b) => b > a).All(x => x));
        }

        [Theory]
        [InlineData(0.0, 60.0)]
        [InlineData(100.0, 6_325.3)]
        [InlineData(1_000_000.0, 30_000.0)]
        public void TheRangeLimitIsTheHorizonCappedAtTheLongestRead(double eyeHeight, double expected)
        {
            Assert.Equal(expected, LandingHorizon.RangeLimit(eyeHeight, MunRadius), 1);
        }

        [Fact]
        public void ALevelPlainSeenFromHeightIsBelowTheLevelEverywhere()
        {
            var angles = LandingHorizon.Profile((_, _) => 0.0, 1_000.0, MunRadius, 5_000.0);
            Assert.All(angles, a => Assert.True(a < 0.0));
            Assert.All(angles, a => Assert.Equal(angles[0], a, 9));
        }

        [Fact]
        public void ARidgeOnOneBearingRaisesOnlyThatBearing()
        {
            // A 400 m wall 1 km east of a vessel 200 m up.
            var angles = LandingHorizon.Profile(
                (azimuth, range) => Math.Abs(azimuth - 90.0) < 1.0 && range >= 1_000.0 ? 400.0 : 0.0,
                200.0,
                MunRadius,
                5_000.0);
            var east = angles[18];
            Assert.True(east > 0.0, "the wall is above the level of the vessel");
            Assert.Equal(angles[0], angles[17], 9);
            Assert.True(east > angles[17]);
        }

        [Fact]
        public void TheGroundCurvesAwayBelowTheLevel()
        {
            var near = LandingHorizon.ElevationAngleDegrees(0.0, 0.0, 100.0, MunRadius);
            var far = LandingHorizon.ElevationAngleDegrees(0.0, 0.0, 20_000.0, MunRadius);
            Assert.True(far < near);
            Assert.True(far < -2.0);
        }

        [Theory]
        [InlineData(false, 0.0, 0.0, 500.0, true)]
        [InlineData(true, 0.4, 900.0, 500.0, false)]
        [InlineData(true, 1.5, 0.0, 500.0, false)]
        [InlineData(true, 1.5, 100.0, 500.0, true)]
        [InlineData(true, 2.0, 0.0, 500.0, true)]
        public void TheProfileIsRetakenOnlyWhenThereIsReasonTo(
            bool have, double seconds, double moved, double height, bool expected)
        {
            Assert.Equal(expected, LandingHorizon.NeedsRefresh(have, seconds, moved, height));
        }
    }
}
