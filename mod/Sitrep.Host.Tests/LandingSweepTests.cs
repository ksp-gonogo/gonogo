using System;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class LandingSweepTests
    {
        private const double Radius = 600_000.0;

        /// <summary>Rolling hills that rise to the north-east, so every bearing has its own skyline.</summary>
        private static double Hills(double azimuth, double range) =>
            200.0 * Math.Sin(range / 900.0) + 0.02 * range * Math.Cos((azimuth - 45.0) * Math.PI / 180.0);

        [Theory]
        [InlineData(1)]
        [InlineData(5)]
        [InlineData(7)]
        [InlineData(LandingHorizon.AzimuthCount)]
        public void AProfileTakenAFewBearingsAtATimeIsTheOneTakenAtOnce(int bearingsPerSample)
        {
            var whole = LandingHorizon.Profile(Hills, 1500.0, Radius, 20_000.0);

            var sweep = new LandingHorizon.Sweep(Hills, 1500.0, Radius, 20_000.0);
            var reads = 0;
            while (sweep.Angles == null)
            {
                reads += sweep.Advance(bearingsPerSample);
            }

            Assert.Equal(whole, sweep.Angles);
            Assert.Equal(LandingHorizon.AzimuthCount * LandingHorizon.RangeSamples, reads);
        }

        [Fact]
        public void AnUnfinishedProfileIsNotHandedOut()
        {
            var sweep = new LandingHorizon.Sweep(Hills, 1500.0, Radius, 20_000.0);

            sweep.Advance(LandingHorizon.AzimuthCount - 1);

            Assert.Null(sweep.Angles);
            Assert.Equal(LandingHorizon.RangeSamples, sweep.Advance(10));
            Assert.NotNull(sweep.Angles);
            Assert.Equal(0, sweep.Advance(10));
        }

        [Theory]
        [InlineData(1)]
        [InlineData(5)]
        [InlineData(LandingSiteGrid.Size)]
        public void AGridTakenAFewRowsAtATimeIsTheOneTakenAtOnce(int rowsPerSample)
        {
            double HeightAt(int row, int column) => (row * 37.0) - (column * 11.0) + Math.Sin(row + column);
            var whole = new double[LandingSiteGrid.Size * LandingSiteGrid.Size];
            for (var row = 0; row < LandingSiteGrid.Size; row++)
            {
                for (var column = 0; column < LandingSiteGrid.Size; column++)
                {
                    whole[row * LandingSiteGrid.Size + column] = HeightAt(row, column);
                }
            }

            var sweep = new LandingSiteGrid.Sweep(HeightAt);
            while (sweep.Heights == null)
            {
                sweep.Advance(rowsPerSample);
            }

            Assert.Equal(whole, sweep.Heights);
        }

        [Theory]
        // One sample a second, as a base-rate reader samples: the whole sweep at once, as before.
        [InlineData(72, 1.0, 1.0, 72)]
        // Ten a second: a tenth of it each sample, so it is done within the second.
        [InlineData(72, 0.1, 1.0, 8)]
        [InlineData(24, 0.1, 0.25, 10)]
        [InlineData(72, 0.001, 1.0, 1)]
        // Nothing known of the rate: all of it.
        [InlineData(72, 0.0, 1.0, 72)]
        [InlineData(72, double.NaN, 1.0, 72)]
        public void EachSampleReadsEnoughToFinishTheSweepInItsTime(int total, double interval, double sweepSeconds, int expected)
        {
            Assert.Equal(expected, LandingSweepPacing.PerSample(total, interval, sweepSeconds));
        }
    }
}
