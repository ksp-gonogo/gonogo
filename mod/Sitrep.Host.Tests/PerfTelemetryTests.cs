using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    [Collection("PerfTelemetry")]
    public sealed class PerfTelemetryTests
    {
        [Fact]
        public void TheFirstRecordingSeedsTheAverageAndLaterOnesMoveItATenthOfTheWay()
        {
            var timings = new PhaseTimings();
            timings.Record("a", 10);
            timings.Record("a", 20);

            var a = Assert.Single(timings.TakeInterval());
            Assert.Equal(11.0, a.EmaMs, 6);
            Assert.Equal(20.0, a.LatestMs);
        }

        [Fact]
        public void TheIntervalMaxTotalAndCountResetWhileTheAverageAndLatestStay()
        {
            var timings = new PhaseTimings();
            timings.Record("a", 5);
            timings.Record("a", 9);
            timings.Record("a", 2);

            var first = Assert.Single(timings.TakeInterval());
            Assert.Equal(9.0, first.IntervalMaxMs);
            Assert.Equal(16.0, first.IntervalTotalMs);
            Assert.Equal(3, first.Count);

            var second = Assert.Single(timings.TakeInterval());
            Assert.Equal(0.0, second.IntervalMaxMs);
            Assert.Equal(0.0, second.IntervalTotalMs);
            Assert.Equal(0, second.Count);
            Assert.Equal(2.0, second.LatestMs);
            Assert.Equal(first.EmaMs, second.EmaMs);
        }

        [Fact]
        public void PhasesComeBackInNameOrder()
        {
            var timings = new PhaseTimings();
            timings.Record("b", 1);
            timings.Record("a", 1);

            Assert.Equal(new[] { "a", "b" }, System.Array.ConvertAll(timings.TakeInterval(), p => p.Name));
        }

        [Fact]
        public void TopicBytesBecomeARateOverTheInterval()
        {
            var counter = new TopicByteCounter();
            counter.Add("vessel.flight", 300);
            counter.Add("vessel.flight", 200);

            var taken = Assert.Single(counter.TakeInterval(2.0));
            Assert.Equal(new KeyValuePair<string, double>("vessel.flight", 250.0), taken);
            Assert.Empty(counter.TakeInterval(1.0));
        }

        [Fact]
        public void NothingIsRecordedOrReportedWhileOff()
        {
            PerfTelemetry.Enabled = false;

            using (PerfTelemetry.Time("a"))
            {
            }
            PerfTelemetry.RecordTicks("a", 1000);
            PerfTelemetry.RecordFrameBytes("vessel.flight", 100);

            Assert.Null(PerfTelemetry.TakeIntervalJson());

            PerfTelemetry.Enabled = true;
            try
            {
                var json = PerfTelemetry.TakeIntervalJson();
                Assert.Equal("\"phases\":{},\"topicBytesPerSec\":{}", json);
            }
            finally
            {
                PerfTelemetry.Enabled = false;
            }
        }

        [Fact]
        public void AScopeRecordsItsPhaseWhileOn()
        {
            PerfTelemetry.Enabled = true;
            try
            {
                using (PerfTelemetry.Time("courier.test"))
                {
                }
                PerfTelemetry.RecordFrameBytes("t\"x", 10);

                var json = PerfTelemetry.TakeIntervalJson();
                Assert.Contains("\"courier.test\":{\"emaMs\":", json);
                Assert.Contains("\"t\\\"x\":", json);
            }
            finally
            {
                PerfTelemetry.Enabled = false;
            }
        }
    }
}
