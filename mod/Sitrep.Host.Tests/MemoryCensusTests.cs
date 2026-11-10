using System;
using System.Diagnostics;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class MemoryCensusTests
    {
        [Fact]
        public void IsOffUntilAnIntervalIsSet()
        {
            var census = new MemoryCensus();
            var counted = 0;
            census.Add("things", () => ++counted);

            Assert.False(census.Enabled);
            Assert.Null(census.TryTakeReport(Stopwatch.GetTimestamp()));
            Assert.Equal(0, counted);
        }

        [Fact]
        public void WritesEveryCounterInOrderThenWaitsOutTheInterval()
        {
            var census = new MemoryCensus();
            census.Add("a", () => 3L);
            census.Add(string.Empty, () => "b=4 c=5");
            census.ReportIntervalSeconds = 60;

            var now = Stopwatch.GetTimestamp();
            var line = census.TryTakeReport(now);

            Assert.NotNull(line);
            Assert.StartsWith(MemoryCensus.LogPrefix + " managed=", line);
            Assert.Contains(" gen0=", line);
            Assert.EndsWith(" a=3 b=4 c=5", line);
            Assert.Null(census.TryTakeReport(now + Stopwatch.Frequency));
            Assert.NotNull(census.TryTakeReport(now + 61 * Stopwatch.Frequency));
        }

        [Fact]
        public void ACounterThatThrowsIsMarkedAndTheRestStillFollow()
        {
            var census = new MemoryCensus();
            census.Add("broken", new Func<long>(() => throw new InvalidOperationException()));
            census.Add("fine", () => 1L);
            census.ReportIntervalSeconds = 1;

            Assert.EndsWith(" broken=! fine=1", census.TryTakeReport(Stopwatch.GetTimestamp()));
        }

        [Fact]
        public void EveryCounterTheEngineRegistersReads()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.Census.ReportIntervalSeconds = 1;

            var line = engine.Census.TryTakeReport(Stopwatch.GetTimestamp());

            Assert.NotNull(line);
            Assert.DoesNotContain("=!", line);
            Assert.Contains(" archive.samples=0 ", line);
            Assert.Contains(" heldBytes=0", line);
        }

        [Fact]
        public void AZeroIntervalTurnsItOff()
        {
            var census = new MemoryCensus();
            census.ReportIntervalSeconds = 5;
            census.ReportIntervalSeconds = 0;

            Assert.False(census.Enabled);
            Assert.Null(census.TryTakeReport(Stopwatch.GetTimestamp()));
        }
    }
}
