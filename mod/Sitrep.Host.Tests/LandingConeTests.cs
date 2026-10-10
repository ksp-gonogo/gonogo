using System;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Where the edges of a cone about the travel vector meet the ground: the
    /// footprint the cross-section is sampled along, including the shallow, level,
    /// climbing and stationary cases where an edge never meets it.
    /// </summary>
    public class LandingConeTests
    {
        private const double MunRadius = 200_000.0;
        private static readonly double Tan60 = Math.Tan(60.0 * Math.PI / 180.0);

        [Fact]
        public void StraightDownTheFootprintIsSymmetricAndASixtyDegreeConeWide()
        {
            var f = LandingCone.FootprintOf(1_000.0, 100.0, 0.0, MunRadius);
            Assert.Equal(-1_000.0 * Tan60, f.Behind, 6);
            Assert.Equal(1_000.0 * Tan60, f.Ahead, 6);
            Assert.False(f.BehindCapped);
            Assert.False(f.AheadCapped);
        }

        [Fact]
        public void AStationaryVesselLooksStraightDown()
        {
            var still = LandingCone.FootprintOf(1_000.0, 0.0, 0.0, MunRadius);
            var down = LandingCone.FootprintOf(1_000.0, 50.0, 0.0, MunRadius);
            Assert.Equal(down.Behind, still.Behind, 9);
            Assert.Equal(down.Ahead, still.Ahead, 9);
        }

        [Fact]
        public void TravellingAtFortyFiveDegreesTheConeLeansAheadOfTheVessel()
        {
            // Axis 45 degrees below the horizontal: edges at 105 (behind and down) and -15 (above the horizon).
            var f = LandingCone.FootprintOf(1_000.0, 100.0, 100.0, MunRadius);
            Assert.Equal(1_000.0 / Math.Tan(105.0 * Math.PI / 180.0), f.Behind, 6);
            Assert.True(f.Behind < 0);
            Assert.True(f.AheadCapped);
            Assert.False(f.BehindCapped);
        }

        [Fact]
        public void ASteepDescentAheadMeetsTheGroundOnBothEdges()
        {
            // Axis 80 degrees: edges at 140 (behind) and 20 (ahead), both meet the ground.
            var f = LandingCone.FootprintOf(
                1_000.0,
                100.0 * Math.Sin(80.0 * Math.PI / 180.0),
                100.0 * Math.Cos(80.0 * Math.PI / 180.0),
                MunRadius);
            Assert.False(f.BehindCapped);
            Assert.False(f.AheadCapped);
            Assert.True(f.Behind < 0);
            Assert.True(f.Ahead > f.Behind);
            Assert.Equal(1_000.0 / Math.Tan(20.0 * Math.PI / 180.0), f.Ahead, 6);
        }

        [Fact]
        public void AShallowApproachCutsTheFarEdgeAtTheRangeTheHorizonAllows()
        {
            // 10 degrees below level: the far edge points above the horizon and meets no ground.
            var f = LandingCone.FootprintOf(
                1_000.0,
                100.0 * Math.Sin(10.0 * Math.PI / 180.0),
                100.0 * Math.Cos(10.0 * Math.PI / 180.0),
                MunRadius);
            Assert.True(f.AheadCapped);
            Assert.Equal(LandingCone.MaxRangeMeters(1_000.0, MunRadius), f.Ahead, 6);
            Assert.False(f.BehindCapped);
        }

        [Fact]
        public void LevelFlightHasAFootprintAheadOnlyAndCutAtTheHorizon()
        {
            var f = LandingCone.FootprintOf(1_000.0, 0.0, 100.0, MunRadius);
            Assert.True(f.AheadCapped);
            Assert.Equal(1_000.0 / Math.Tan(60.0 * Math.PI / 180.0), f.Behind, 6);
            Assert.True(f.Behind > 0);
        }

        [Fact]
        public void AClimbingVesselSeesBehindAndBelowAndNothingAhead()
        {
            // Climbing at 30 degrees: the axis is -30 below the horizontal, so the edges are at 30 (meets the ground ahead of the vessel, behind the climb) and -90 (straight up).
            var f = LandingCone.FootprintOf(
                1_000.0,
                -100.0 * Math.Sin(30.0 * Math.PI / 180.0),
                100.0 * Math.Cos(30.0 * Math.PI / 180.0),
                MunRadius);
            Assert.True(f.AheadCapped);
            Assert.False(f.BehindCapped);
            Assert.Equal(1_000.0 / Math.Tan(30.0 * Math.PI / 180.0), f.Behind, 6);
        }

        [Fact]
        public void TheRangeIsTheHorizonOnASmallBodyAndTheAbsoluteLimitOnABigOne()
        {
            Assert.Equal(Math.Sqrt(2 * MunRadius * 1_000.0 + 1_000.0 * 1_000.0), LandingCone.MaxRangeMeters(1_000.0, MunRadius), 6);
            Assert.Equal(LandingCone.AbsoluteMaxRangeMeters, LandingCone.MaxRangeMeters(500_000.0, MunRadius), 6);
        }

        [Fact]
        public void TheFootprintNarrowsInStepWithTheHeightWhateverTheAngle()
        {
            var high = LandingCone.FootprintOf(4_000.0, 100.0, 40.0, MunRadius);
            var low = LandingCone.FootprintOf(1_000.0, 100.0, 40.0, MunRadius);
            Assert.Equal(high.Behind / 4.0, low.Behind, 6);
            Assert.Equal(high.Ahead / 4.0, low.Ahead, 6);
        }

        [Theory]
        [InlineData(double.NaN, 10.0, 10.0)]
        [InlineData(1_000.0, double.NaN, 10.0)]
        [InlineData(1_000.0, 10.0, double.NaN)]
        [InlineData(-5.0, 10.0, 10.0)]
        public void NonsenseInputIsTreatedAsNone(double height, double down, double along)
        {
            var f = LandingCone.FootprintOf(height, down, along, MunRadius);
            Assert.False(double.IsNaN(f.Behind));
            Assert.False(double.IsNaN(f.Ahead));
            Assert.True(f.Ahead >= f.Behind);
        }

        [Fact]
        public void ANegativeHorizontalSpeedIsTreatedAsNone()
        {
            var f = LandingCone.FootprintOf(1_000.0, 100.0, -50.0, MunRadius);
            var straight = LandingCone.FootprintOf(1_000.0, 100.0, 0.0, MunRadius);
            Assert.Equal(straight.Ahead, f.Ahead, 9);
        }
    }
}
