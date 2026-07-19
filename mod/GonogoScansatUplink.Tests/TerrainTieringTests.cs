using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    public class TerrainTieringTests
    {
        [Theory]
        [InlineData(-45.3, -45.2)]  // truncate-toward-zero after *5, then /5.0 (float division)
        [InlineData(45.3, 45.2)]
        [InlineData(0.0, 0.0)]
        [InlineData(-0.1, 0.0)]     // -0.1*5=-0.5 -> (int)=0 -> 0/5.0=0.0
        [InlineData(12.34, 12.2)]
        public void Snap02MatchesScansatsIntTruncateThenFloatDivideIdiom(double input, double expected)
        {
            Assert.Equal(expected, TerrainTiering.Snap02(input), 3);
        }

        [Fact]
        public void ResolveSampleCoordinateReturnsExactPointWhenHiResCovered()
        {
            var (lon, lat) = TerrainTiering.ResolveSampleCoordinate(12.34, -56.78, hiResCovered: true, loResCovered: true);
            Assert.Equal(12.34, lon);
            Assert.Equal(-56.78, lat);
        }

        [Fact]
        public void ResolveSampleCoordinateSnapsWhenOnlyLoResCovered()
        {
            var (lon, lat) = TerrainTiering.ResolveSampleCoordinate(12.34, -56.78, hiResCovered: false, loResCovered: true);
            Assert.Equal(TerrainTiering.Snap02(12.34), lon);
            Assert.Equal(TerrainTiering.Snap02(-56.78), lat);
        }

        [Fact]
        public void ResolveSampleCoordinateReturnsExactPointWhenUncoveredFallback()
        {
            // Uncovered cells still get sampled today (the CLIENT's mask
            // gate withholds them from the user) - unchanged behavior.
            var (lon, lat) = TerrainTiering.ResolveSampleCoordinate(12.34, -56.78, hiResCovered: false, loResCovered: false);
            Assert.Equal(12.34, lon);
            Assert.Equal(-56.78, lat);
        }
    }
}
