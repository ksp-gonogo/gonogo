using System;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The geometry of the terrain grid on <c>vessel.landing</c>: how wide it is,
    /// where each point sits, and how often it is taken again.
    /// </summary>
    public class LandingSiteGridTests
    {
        [Fact]
        public void TheGridIsTheSizeItSaysSoTheReadsPerGridAreBounded()
        {
            Assert.Equal(24, LandingSiteGrid.Size);
            Assert.True(LandingSiteGrid.Size * LandingSiteGrid.Size <= 600);
        }

        [Fact]
        public void TheGridNeverShrinksBelowTheFloor()
        {
            Assert.True(LandingSiteGrid.HalfExtentMeters(0.0, 0.0) >= LandingSiteGrid.MinHalfExtentMeters);
        }

        [Fact]
        public void TheGridHoldsTheWholeWindowOfAVesselStraightOverTheSite()
        {
            // The window reaches its touchdown width plus 0.9 of the height each way, and the grid a margin past that.
            var half = LandingSiteGrid.HalfExtentMeters(0.0, 1_000.0);
            Assert.Equal((LandingSiteGrid.WindowMinHalfMeters + 900.0) * LandingSiteGrid.ReachMargin, half, 6);
        }

        [Theory]
        [InlineData(8_000.0, 0.0)]
        [InlineData(8_000.0, 4_000.0)]
        [InlineData(1_000.0, 200.0)]
        [InlineData(291.0, 60.0)]
        [InlineData(30.0, 5.0)]
        [InlineData(3_000.0, 30_000.0)]
        public void TheGridReachesPastTheFarEdgeOfTheWindowAtEveryHeightAndDistance(double height, double site)
        {
            var windowHalf = Math.Max(
                LandingSiteGrid.WindowMinHalfMeters + height * LandingSiteGrid.WindowHalfPerHeight,
                site / 2 * LandingSiteGrid.WindowSitePadding);
            var half = LandingSiteGrid.HalfExtentMeters(site, height);
            // The window is centred half the distance from the site, along the track.
            Assert.True(half >= site / 2 + windowHalf);
        }

        [Fact]
        public void TheCellsStayNarrowAsTheVesselComesDown()
        {
            // Ten or more cells across the window at 291 m up, where the grid used to be a few giant tiles.
            var half = LandingSiteGrid.HalfExtentMeters(60.0, 291.0);
            var window = 2 * Math.Max(
                LandingSiteGrid.WindowMinHalfMeters + LandingSiteGrid.WindowHalfPerHeight * 291.0,
                60.0 / 2 * LandingSiteGrid.WindowSitePadding);
            Assert.True(window / LandingSiteGrid.CellMeters(half) >= 10.0);
        }

        [Fact]
        public void TheGridNarrowsInStepWithTheHeight()
        {
            var high = LandingSiteGrid.HalfExtentMeters(0.0, 4_000.0);
            var low = LandingSiteGrid.HalfExtentMeters(0.0, 1_000.0);
            Assert.Equal(3_000.0 * LandingSiteGrid.WindowHalfPerHeight * LandingSiteGrid.ReachMargin, high - low, 6);
        }

        [Fact]
        public void TheGridKeepsNarrowingAllTheWayToTheGround()
        {
            // No height below which the window stops closing in: a vessel coming straight down sees the site keep growing until it touches down.
            var previous = LandingSiteGrid.HalfExtentMeters(0.0, 200.0);
            for (var height = 190.0; height >= 0.0; height -= 10.0)
            {
                var half = LandingSiteGrid.HalfExtentMeters(0.0, height);
                Assert.True(half < previous, $"at {height} m");
                previous = half;
            }
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        public void NonsenseIsTreatedAsNone(double bad)
        {
            Assert.Equal(
                LandingSiteGrid.HalfExtentMeters(0.0, 0.0),
                LandingSiteGrid.HalfExtentMeters(bad, bad));
        }

        [Fact]
        public void TheNorthernRowAndTheWesternColumnComeFirst()
        {
            var half = 120.0;
            var first = LandingSiteGrid.Offset(0, 0, half);
            var last = LandingSiteGrid.Offset(LandingSiteGrid.Size - 1, LandingSiteGrid.Size - 1, half);
            Assert.True(first.east < 0 && first.north > 0);
            Assert.True(last.east > 0 && last.north < 0);
        }

        [Fact]
        public void ThePointsAreEvenlySpacedAndCentredOnTheSite()
        {
            var half = 120.0;
            var cell = LandingSiteGrid.CellMeters(half);
            Assert.Equal(2 * half / LandingSiteGrid.Size, cell, 9);
            var a = LandingSiteGrid.Offset(5, 5, half);
            var b = LandingSiteGrid.Offset(5, 6, half);
            var c = LandingSiteGrid.Offset(6, 5, half);
            Assert.Equal(cell, b.east - a.east, 9);
            Assert.Equal(cell, a.north - c.north, 9);
            var sw = LandingSiteGrid.Offset(LandingSiteGrid.Size - 1, 0, half);
            var ne = LandingSiteGrid.Offset(0, LandingSiteGrid.Size - 1, half);
            Assert.Equal(0.0, sw.east + ne.east, 9);
            Assert.Equal(0.0, sw.north + ne.north, 9);
        }

        [Fact]
        public void TheFirstGridIsAlwaysTaken()
        {
            Assert.True(LandingSiteGrid.NeedsRefresh(false, 0.0, 0.0, 100.0, 0.0));
        }

        [Fact]
        public void AGridIsNeverRetakenFasterThanTheShortestInterval()
        {
            // Even with the site far from where the grid was taken.
            Assert.False(LandingSiteGrid.NeedsRefresh(true, 0.1, 5_000.0, 100.0, 100.0));
        }

        [Fact]
        public void AGridIsKeptWhileNothingHasChanged()
        {
            Assert.False(LandingSiteGrid.NeedsRefresh(true, 0.5, 1.0, 100.0, 100.0));
        }

        [Fact]
        public void AGridIsRetakenEarlyWhenTheSiteMovesAPointsWidth()
        {
            var cell = LandingSiteGrid.CellMeters(100.0);
            Assert.True(LandingSiteGrid.NeedsRefresh(true, 0.5, cell * 1.1, 100.0, 100.0));
        }

        [Fact]
        public void AGridIsRetakenEarlyWhenItsExtentHasChangedEnough()
        {
            Assert.True(LandingSiteGrid.NeedsRefresh(true, 0.5, 0.0, 140.0, 100.0));
            Assert.False(LandingSiteGrid.NeedsRefresh(true, 0.5, 0.0, 110.0, 100.0));
        }

        [Fact]
        public void AGridIsAlwaysRetakenAfterTheLongestInterval()
        {
            Assert.True(LandingSiteGrid.NeedsRefresh(true, LandingSiteGrid.RefreshSeconds, 0.0, 100.0, 100.0));
        }
    }
}
