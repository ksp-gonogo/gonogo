using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The geometry of the ground-track strip on <c>vessel.landing</c>: its
    /// shape, how it scales with the distance still to travel, and the cost
    /// ceiling on the terrain reads it asks for.
    /// </summary>
    public class LandingGroundTrackTests
    {
        private const double MunRadius = 200_000.0;

        [Theory]
        [InlineData(0.0)]
        [InlineData(300.0)]
        [InlineData(6_400.0)]
        [InlineData(250_000.0)]
        public void TheStripAlwaysAsksForTheSameBoundedNumberOfReads(double toSite)
        {
            Assert.Equal(LandingGroundTrack.SampleCount, LandingGroundTrack.Distances(toSite).Length);
        }

        [Fact]
        public void TheStripStartsUnderTheVesselAndAscendsEvenly()
        {
            var d = LandingGroundTrack.Distances(6_400.0);
            Assert.Equal(0.0, d[0]);
            var step = d[1] - d[0];
            Assert.True(step > 0);
            for (var i = 2; i < d.Length; i++)
            {
                Assert.Equal(step, d[i] - d[i - 1], 6);
            }
        }

        [Fact]
        public void TheStripRunsPastTheSiteByAQuarterOfTheWayStillToGo()
        {
            var d = LandingGroundTrack.Distances(8_000.0);
            Assert.Equal(10_000.0, d[d.Length - 1], 6);
        }

        [Fact]
        public void TheStripNarrowsToTheSiteAsTheVesselDescends()
        {
            var high = LandingGroundTrack.Distances(6_400.0);
            var low = LandingGroundTrack.Distances(1_200.0);
            Assert.True(low[low.Length - 1] < high[high.Length - 1]);
            Assert.True(low[1] - low[0] < high[1] - high[0]);
        }

        [Fact]
        public void ANearlyLandedVesselStillGetsGroundToRead()
        {
            var d = LandingGroundTrack.Distances(0.0);
            Assert.Equal(LandingGroundTrack.MinExtentMeters, d[d.Length - 1], 6);
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(-50.0)]
        public void ANonsenseDistanceIsTreatedAsNoDistance(double toSite)
        {
            var d = LandingGroundTrack.Distances(toSite);
            Assert.Equal(LandingGroundTrack.MinExtentMeters, d[d.Length - 1], 6);
        }

        [Fact]
        public void DestinationAndDistanceAgree()
        {
            var (lat, lon) = LandingGroundTrack.Destination(10.0, 20.0, 90.0, 5_000.0, MunRadius);
            Assert.Equal(5_000.0, LandingGroundTrack.DistanceMeters(10.0, 20.0, lat, lon, MunRadius), 3);
            Assert.Equal(90.0, LandingGroundTrack.BearingDegrees(10.0, 20.0, lat, lon), 1);
        }

        [Fact]
        public void DestinationWrapsLongitudeAcrossTheAntimeridian()
        {
            var (_, lon) = LandingGroundTrack.Destination(0.0, 179.9, 90.0, 5_000.0, MunRadius);
            Assert.InRange(lon, -180.0, -170.0);
        }
    }
}
