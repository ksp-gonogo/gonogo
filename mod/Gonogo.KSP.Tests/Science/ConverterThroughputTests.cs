using Xunit;

namespace Gonogo.KSP.Tests.Science
{
    /// <summary>A running converter that cannot run is told apart from one that is working.</summary>
    public class ConverterThroughputTests
    {
        [Fact]
        public void ARunningConverterWithNothingAchievedCarriesTheGamesOwnWords()
        {
            var read = ConverterThroughput.Of(running: true, lastTimeFactor: 0, status: "missing Liquid Fuel");

            Assert.Equal(0, read.Throughput);
            Assert.Equal("missing Liquid Fuel", read.Shortfall);
        }

        [Fact]
        public void AWorkingConverterCarriesItsShareAndNoShortfall()
        {
            var read = ConverterThroughput.Of(running: true, lastTimeFactor: 0.5, status: "Load: 50.00%");

            Assert.Equal(0.5, read.Throughput);
            Assert.Null(read.Shortfall);
        }

        [Fact]
        public void AStoppedConverterReportsNothingSoAStaleFigureIsNeverShown()
        {
            var read = ConverterThroughput.Of(running: false, lastTimeFactor: 1, status: "Inactive");

            Assert.Null(read.Throughput);
            Assert.Null(read.Shortfall);
        }

        [Fact]
        public void AStarvedConverterWithNoStatusTextHasAZeroShareAndNoWords()
        {
            var read = ConverterThroughput.Of(running: true, lastTimeFactor: 0, status: " ");

            Assert.Equal(0, read.Throughput);
            Assert.Null(read.Shortfall);
        }

        [Fact]
        public void AFigureOutsideZeroToOneIsClampedAndANonNumberIsUnread()
        {
            Assert.Equal(1, ConverterThroughput.Of(true, 1.2, null).Throughput);
            Assert.Null(ConverterThroughput.Of(true, double.NaN, null).Throughput);
        }
    }
}
