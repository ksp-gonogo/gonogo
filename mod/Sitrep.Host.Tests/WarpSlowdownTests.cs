using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class WarpSlowdownTests
    {
        private static readonly double[] Stock = { 1, 5, 10, 50, 100, 1000, 10000, 100000 };

        [Fact]
        public void PicksTheHighestRungWithinTheRate()
        {
            Assert.Equal(4, WarpSlowdown.SlowTo(Stock, 7, 150));
            Assert.Equal(6, WarpSlowdown.SlowTo(Stock, 7, 50_000));
        }

        [Fact]
        public void SendsNothingWhenTheCurrentRungIsAlreadyWithinTheRate()
        {
            Assert.Null(WarpSlowdown.SlowTo(Stock, 4, 100));
            Assert.Null(WarpSlowdown.SlowTo(Stock, 4, 1_000_000));
            Assert.Null(WarpSlowdown.SlowTo(Stock, 0, 0.5));
        }

        [Fact]
        public void ARateBelowEveryRungAnswersTheFloor()
        {
            Assert.Equal(0, WarpSlowdown.SlowTo(Stock, 5, 0.1));
        }
    }
}
