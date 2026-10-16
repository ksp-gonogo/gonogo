using Xunit;

namespace Sitrep.Host.Tests
{
    public class LogLimiterTests
    {
        private double _now;

        private LogLimiter Make(double interval = 60)
        {
            return new LogLimiter(() => _now, interval);
        }

        [Fact]
        public void TheFirstOccurrenceLogsWithNothingHeld()
        {
            var limiter = Make();

            Assert.True(limiter.ShouldLog("a", out int held));
            Assert.Equal(0, held);
        }

        [Fact]
        public void RepeatsInsideTheIntervalAreHeldBack()
        {
            var limiter = Make();
            limiter.ShouldLog("a", out _);

            _now = 59;
            Assert.False(limiter.ShouldLog("a", out _));
            Assert.False(limiter.ShouldLog("a", out _));
        }

        [Fact]
        public void TheNextLineAfterTheIntervalCountsWhatWasHeld()
        {
            var limiter = Make();
            limiter.ShouldLog("a", out _);
            limiter.ShouldLog("a", out _);
            limiter.ShouldLog("a", out _);

            _now = 60;
            Assert.True(limiter.ShouldLog("a", out int held));
            Assert.Equal(2, held);
        }

        [Fact]
        public void TheCountRestartsAfterEachLoggedLine()
        {
            var limiter = Make();
            limiter.ShouldLog("a", out _);
            limiter.ShouldLog("a", out _);
            _now = 60;
            limiter.ShouldLog("a", out _);

            _now = 120;
            Assert.True(limiter.ShouldLog("a", out int held));
            Assert.Equal(0, held);
        }

        [Fact]
        public void KeysAreLimitedIndependently()
        {
            var limiter = Make();
            limiter.ShouldLog("a", out _);

            Assert.True(limiter.ShouldLog("b", out int held));
            Assert.Equal(0, held);
        }

        [Fact]
        public void ComposeLeavesTheFirstLineAloneAndAppendsTheCountAfter()
        {
            Assert.Equal("read failed", LogLimiter.Compose("read failed", 0));
            Assert.Equal("read failed (7 more since the last line)", LogLimiter.Compose("read failed", 7));
        }
    }
}
