using System;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The geometry of the ground-track strip on <c>vessel.landing</c>: the cone of
    /// ground it covers, how that scales with height, and the cost ceiling on the
    /// terrain reads it asks for.
    /// </summary>
    public class LandingGroundTrackTests
    {
        private const double MunRadius = 200_000.0;

        [Theory]
        [InlineData(1_000.0, 100.0, 0.0, 0.0)]
        [InlineData(1_000.0, 50.0, 50.0, 800.0)]
        [InlineData(1_000.0, 17.36, 98.48, 0.0)]
        [InlineData(1_000.0, 0.0, 100.0, 25_000.0)]
        [InlineData(1_000.0, -30.0, 80.0, 25_000.0)]
        [InlineData(3_000.0, 3.0, 5.0, 40.0)]
        [InlineData(2.0, 3.0, 5.0, 0.0)]
        [InlineData(50_000.0, 200.0, 1_000.0, 200_000.0)]
        public void TheStripHoldsTheGroundBeneathTheVesselAndAMarginBehindItForEveryApproachAngle(
            double height, double descent, double along, double site)
        {
            var f = LandingCone.FootprintOf(height, descent, along, MunRadius);
            var (behind, ahead) = LandingGroundTrack.Extent(f.Behind, f.Ahead, height, site);
            var d = LandingGroundTrack.Distances(behind, ahead);
            Assert.True(d[0] <= -Math.Max(height, LandingGroundTrack.MinMarginMeters) + 1e-9);
            Assert.True(d[d.Length - 1] >= site * (1.0 + LandingGroundTrack.SiteReachFraction) - 1e-9);
            Assert.Contains(d, x => x <= 0.0);
            Assert.Contains(d, x => x >= 0.0);
        }

        [Fact]
        public void TheStripKeepsTheConesOwnEdgesWhenTheyReachFartherThanTheMargin()
        {
            var f = LandingCone.FootprintOf(1_000.0, 100.0, 0.0, MunRadius);
            var (behind, ahead) = LandingGroundTrack.Extent(f.Behind, f.Ahead, 1_000.0, 0.0);
            Assert.Equal(f.Behind, behind, 9);
            Assert.Equal(f.Ahead, ahead, 9);
        }

        [Theory]
        [InlineData(-1_000.0, 1_000.0)]
        [InlineData(-5.0, 5.0)]
        [InlineData(0.0, 0.0)]
        [InlineData(300.0, 40_000.0)]
        public void TheStripAlwaysAsksForTheSameBoundedNumberOfReads(double behind, double ahead)
        {
            Assert.Equal(LandingGroundTrack.SampleCount, LandingGroundTrack.Distances(behind, ahead).Length);
        }

        [Fact]
        public void TheStripRunsFromOneEdgeOfTheFootprintToTheOtherInEvenSteps()
        {
            var d = LandingGroundTrack.Distances(-1_732.0, 1_732.0);
            Assert.Equal(-1_732.0, d[0], 9);
            Assert.Equal(1_732.0, d[d.Length - 1], 9);
            var step = d[1] - d[0];
            Assert.True(step > 0);
            for (var i = 2; i < d.Length; i++)
            {
                Assert.Equal(step, d[i] - d[i - 1], 6);
            }
        }

        [Fact]
        public void TheSamplesGetCloserTogetherAsTheFootprintNarrows()
        {
            var wide = LandingGroundTrack.Distances(-13_856.0, 13_856.0);
            var narrow = LandingGroundTrack.Distances(-1_732.0, 1_732.0);
            Assert.True(narrow[1] - narrow[0] < wide[1] - wide[0]);
            Assert.Equal(8.0, (wide[1] - wide[0]) / (narrow[1] - narrow[0]), 6);
        }

        [Fact]
        public void AFootprintAheadOfTheVesselIsReadWhereItIs()
        {
            var d = LandingGroundTrack.Distances(360.0, 2_000.0);
            Assert.Equal(360.0, d[0], 9);
            Assert.Equal(2_000.0, d[d.Length - 1], 9);
        }

        [Fact]
        public void ATinyFootprintIsWidenedToTheLeastGroundAboutItsMiddle()
        {
            var d = LandingGroundTrack.Distances(-5.0, 15.0);
            Assert.Equal(LandingGroundTrack.MinExtentMeters, d[d.Length - 1] - d[0], 6);
            Assert.Equal(5.0, (d[0] + d[d.Length - 1]) / 2, 6);
        }

        [Fact]
        public void EdgesGivenTheWrongWayRoundAreSorted()
        {
            var d = LandingGroundTrack.Distances(1_000.0, -1_000.0);
            Assert.Equal(-1_000.0, d[0], 9);
            Assert.Equal(1_000.0, d[d.Length - 1], 9);
        }

        [Fact]
        public void NanEdgesAreTreatedAsNone()
        {
            var d = LandingGroundTrack.Distances(double.NaN, double.NaN);
            Assert.Equal(LandingGroundTrack.MinExtentMeters, d[d.Length - 1] - d[0], 6);
        }

        [Fact]
        public void DestinationAndDistanceAgree()
        {
            var (lat, lon) = LandingGroundTrack.Destination(10.0, 20.0, 90.0, 5_000.0, MunRadius);
            Assert.Equal(5_000.0, LandingGroundTrack.DistanceMeters(10.0, 20.0, lat, lon, MunRadius), 3);
            Assert.Equal(90.0, LandingGroundTrack.BearingDegrees(10.0, 20.0, lat, lon), 1);
        }

        [Fact]
        public void ANegativeDistanceIsTheSameGreatCircleTheOtherWay()
        {
            var ahead = LandingGroundTrack.Destination(10.0, 20.0, 90.0, 5_000.0, MunRadius);
            var behind = LandingGroundTrack.Destination(10.0, 20.0, 90.0, -5_000.0, MunRadius);
            Assert.True(behind.lon < 20.0);
            Assert.True(ahead.lon > 20.0);
            Assert.Equal(ahead.lat, behind.lat, 6);
            Assert.Equal(
                LandingGroundTrack.DistanceMeters(10.0, 20.0, behind.lat, behind.lon, MunRadius),
                LandingGroundTrack.DistanceMeters(10.0, 20.0, ahead.lat, ahead.lon, MunRadius),
                3);
        }

        [Fact]
        public void DestinationWrapsLongitudeAcrossTheAntimeridian()
        {
            var (_, lon) = LandingGroundTrack.Destination(0.0, 179.9, 90.0, 5_000.0, MunRadius);
            Assert.InRange(lon, -180.0, -170.0);
        }
    }
}
