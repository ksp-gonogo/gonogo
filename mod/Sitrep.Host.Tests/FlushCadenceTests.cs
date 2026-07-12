using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Periodic-flush cadence gate: proves <see cref="FlushCadence.ShouldFlush"/>
    /// gates on real elapsed time rather than sampling cadence, and stays a
    /// plain threshold comparison so <c>GonogoAddon.FixedUpdate</c> can call
    /// it every physics tick without building its own accumulation logic.
    /// </summary>
    public class FlushCadenceTests
    {
        private const double IntervalSeconds = 60.0;

        [Fact]
        public void BeforeIntervalElapsedDoesNotFlush()
        {
            Assert.False(FlushCadence.ShouldFlush(elapsedSinceLastFlushSeconds: 0.0, IntervalSeconds));
            Assert.False(FlushCadence.ShouldFlush(elapsedSinceLastFlushSeconds: 59.9, IntervalSeconds));
        }

        [Fact]
        public void AtOrPastIntervalFlushes()
        {
            Assert.True(FlushCadence.ShouldFlush(elapsedSinceLastFlushSeconds: 60.0, IntervalSeconds));
            Assert.True(FlushCadence.ShouldFlush(elapsedSinceLastFlushSeconds: 90.0, IntervalSeconds));
        }

        [Fact]
        public void ZeroOrNegativeIntervalNeverBlocksAFlush()
        {
            // Defensive: a misconfigured non-positive interval must not
            // deadlock the periodic flush - it should always fire.
            Assert.True(FlushCadence.ShouldFlush(elapsedSinceLastFlushSeconds: 0.0, intervalSeconds: 0.0));
            Assert.True(FlushCadence.ShouldFlush(elapsedSinceLastFlushSeconds: 0.0, intervalSeconds: -1.0));
        }
    }
}
