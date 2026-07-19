using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    public class TerrainTieringTests
    {
        [Theory]
        [InlineData(12.34, 12.0)]
        [InlineData(0.99, 0.0)]
        [InlineData(179.9, 179.0)]
        [InlineData(-45.3, -45.0)]
        [InlineData(-0.7, 0.0)]
        public void Snap02MatchesScansatsIntTruncateThenIntDivideIdiom(double input, double expected)
        {
            // (int)(v * 5.0) / 5 in the decompiled source is INTEGER
            // division (the divisor is a literal `5`, not `5.0`), which
            // truncates a second time and algebraically collapses to
            // whole-degree truncation-toward-zero - not a 0.2-degree snap.
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
