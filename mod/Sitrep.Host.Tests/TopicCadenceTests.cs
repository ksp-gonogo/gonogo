using System.Collections.Generic;
using System.Diagnostics;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A topic runs at one sample per UT second unless an override names it; an override
    /// speeds up only the topic it names, the sampling gate follows the fastest one, and
    /// the cost of each topic is accounted on its own.
    /// </summary>
    public class TopicCadenceTests
    {
        private const double TickUt = 0.02;

        private static LoadState StandingIn(string scene)
        {
            var load = new LoadState();
            load.Seed(scene);
            return load;
        }

        /// <summary>Drives the gate and the per-topic check the way the addon and the engine do, and counts evaluations per topic.</summary>
        private static Dictionary<string, int> Run(TopicCadence cadence, string[] topics, double seconds)
        {
            var gate = new SampleGate(StandingIn("FLIGHT"), cadence);
            var counts = new Dictionary<string, int>();
            foreach (var topic in topics)
            {
                counts[topic] = 0;
            }

            var ticks = (int)(seconds / TickUt);
            for (var tick = 0; tick <= ticks; tick++)
            {
                var ut = 1000.0 + tick * TickUt;
                if (!gate.Admit(ut, warpRate: 1.0, realSec: tick * TickUt))
                {
                    continue;
                }
                foreach (var topic in topics)
                {
                    if (cadence.IsDue(topic, ut))
                    {
                        counts[topic]++;
                    }
                }
            }
            return counts;
        }

        [Fact]
        public void EveryTopicDefaultsToOneSamplePerUtSecond()
        {
            var cadence = new TopicCadence();

            Assert.Equal(SampleCadence.IntervalUt, cadence.IntervalUtFor("vessel.flight"));
            Assert.Equal(SampleCadence.IntervalUt, cadence.FastestIntervalUt);
            Assert.False(cadence.HasOverrides);
            Assert.Equal("none", cadence.Describe());
        }

        [Fact]
        public void WithNoOverrideEveryCallIsDueEvenWhenTheClockStandsStill()
        {
            var cadence = new TopicCadence();

            Assert.True(cadence.IsDue("vessel.flight", 100.0));
            Assert.True(cadence.IsDue("vessel.flight", 100.0));
            Assert.True(cadence.IsDue("vessel.flight", 100.5));
        }

        [Fact]
        public void AnOverrideSpeedsUpOnlyTheTopicItNames()
        {
            var cadence = new TopicCadence();
            Assert.True(cadence.TrySetRateHz("vessel.landing", 5, out _));

            var counts = Run(cadence, new[] { "vessel.landing", "vessel.flight" }, seconds: 20);

            Assert.InRange(counts["vessel.landing"], 90, 101);
            Assert.InRange(counts["vessel.flight"], 19, 21);
            Assert.Equal(0.2, cadence.IntervalUtFor("vessel.landing"), 9);
            Assert.Equal(SampleCadence.IntervalUt, cadence.IntervalUtFor("vessel.flight"));
        }

        [Fact]
        public void TheGateAdmitsAtTheFastestTopicsInterval()
        {
            var cadence = new TopicCadence();
            cadence.TrySetRateHz("vessel.flight", 2, out _);
            Assert.Equal(0.5, cadence.FastestIntervalUt, 9);

            cadence.TrySetRateHz("vessel.landing", 10, out _);
            Assert.Equal(0.1, cadence.FastestIntervalUt, 9);

            cadence.ClearOverrides();
            Assert.Equal(SampleCadence.IntervalUt, cadence.FastestIntervalUt);
            Assert.False(cadence.HasOverrides);
        }

        [Fact]
        public void ADefaultTopicKeepsItsOneSecondCadenceWhileTheGateRunsTenTimesFaster()
        {
            var cadence = new TopicCadence();
            cadence.TrySetRateHz("vessel.landing", 10, out _);

            var counts = Run(cadence, new[] { "vessel.flight" }, seconds: 30);

            Assert.InRange(counts["vessel.flight"], 26, 31);
        }

        [Fact]
        public void ASlowerOverrideIsHonouredAndDoesNotSlowTheGate()
        {
            var cadence = new TopicCadence();
            cadence.TrySetRateHz("vessel.flight", 0.5, out _);

            Assert.Equal(SampleCadence.IntervalUt, cadence.FastestIntervalUt);
            Assert.InRange(Run(cadence, new[] { "vessel.flight" }, seconds: 20)["vessel.flight"], 9, 11);
        }

        [Fact]
        public void ABackwardJumpIsDueAtOnceAndReanchorsTheTopic()
        {
            var cadence = new TopicCadence();
            cadence.TrySetRateHz("vessel.flight", 1, out _);

            Assert.True(cadence.IsDue("vessel.flight", 500.0));
            Assert.False(cadence.IsDue("vessel.flight", 500.4));
            Assert.True(cadence.IsDue("vessel.flight", 200.0));
            Assert.False(cadence.IsDue("vessel.flight", 200.4));
            Assert.True(cadence.IsDue("vessel.flight", 201.0));
        }

        [Fact]
        public void AStoppedClockIsDueOnEveryAdmittedSampleWhileAnOverrideIsInForce()
        {
            var cadence = new TopicCadence();
            cadence.TrySetRateHz("vessel.landing", 5, out _);

            Assert.True(cadence.IsDue("vessel.flight", 700.0));
            Assert.True(cadence.IsDue("vessel.flight", 700.0));
        }

        [Fact]
        public void ARateOutsideTheSupportedRangeIsRefusedAndChangesNothing()
        {
            var cadence = new TopicCadence();

            foreach (var hz in new[] { 0.0, -1.0, double.NaN, double.PositiveInfinity, TopicCadence.MaxRateHz + 1 })
            {
                Assert.False(cadence.TrySetRateHz("vessel.flight", hz, out var refusal));
                Assert.NotNull(refusal);
            }
            Assert.False(cadence.TrySetRateHz("", 5, out _));
            Assert.False(cadence.HasOverrides);
        }

        [Fact]
        public void DescribeReadsBackTheRatesInForce()
        {
            var cadence = new TopicCadence();
            cadence.TrySetRateHz("vessel.landing", 5, out _);
            cadence.TrySetRateHz("vessel.flight", 2, out _);

            Assert.Equal("vessel.flight=2 Hz, vessel.landing=5 Hz", cadence.Describe());
        }

        [Fact]
        public void TheRealTimeFloorStillThinsAFastTopicUnderWarp()
        {
            Assert.Equal(0.1, SampleCadence.IntervalUtAt(1.0, 0.1), 9);
            Assert.Equal(0.2, SampleCadence.IntervalUtAt(2.0, 0.1), 9);
            Assert.Equal(10.0, SampleCadence.IntervalUtAt(100.0, 0.1), 9);
            Assert.Equal(SampleCadence.IntervalUtAt(50.0), SampleCadence.IntervalUtAt(50.0, SampleCadence.IntervalUt));
        }
    }

    /// <summary>The cost lines carry one prefix, account each topic on its own, and the window restarts after a report.</summary>
    public class TopicPublishStatsTests
    {
        private static long Seconds(long start, double seconds) => start + (long)(seconds * Stopwatch.Frequency);

        private static long Ms(double ms) => (long)(ms * Stopwatch.Frequency / 1000.0);

        [Fact]
        public void NothingIsRecordedOrReportedUntilAnIntervalIsSet()
        {
            var stats = new TopicPublishStats();
            stats.RecordBuild("vessel.flight", Ms(1));
            stats.RecordFrame("vessel.flight", 100, Ms(1));

            Assert.False(stats.Enabled);
            Assert.Null(stats.TryTakeReport(Stopwatch.GetTimestamp() + Stopwatch.Frequency * 100, "none"));
        }

        [Fact]
        public void EachTopicIsAccountedOnItsOwn()
        {
            var stats = new TopicPublishStats { ReportIntervalSeconds = 10 };
            var start = Stopwatch.GetTimestamp();
            for (var i = 0; i < 50; i++)
            {
                stats.RecordBuild("vessel.landing", Ms(2));
                stats.RecordEmit("vessel.landing");
                stats.RecordFrame("vessel.landing", 13_926, Ms(1));
            }
            for (var i = 0; i < 10; i++)
            {
                stats.RecordBuild("vessel.flight", Ms(0.5));
                stats.RecordEmit("vessel.flight");
                stats.RecordFrame("vessel.flight", 400, Ms(0.1));
            }

            var lines = stats.TryTakeReport(Seconds(start, 10), "vessel.landing=5 Hz");

            Assert.NotNull(lines);
            Assert.All(lines!, line => Assert.StartsWith(TopicPublishStats.LogPrefix, line));
            Assert.Contains("vessel.landing=5 Hz", lines![0]);
            Assert.Contains("vessel.landing: built 50 (5.0/s, 100.00 ms total, 2.000 ms each), emitted 50 (5.0/s), frames 50 (5.0/s), 68.0 KB/s", lines[1]);
            Assert.Contains("vessel.flight: built 10 (1.0/s", lines[2]);
        }

        [Fact]
        public void NoReportIsDueBeforeTheIntervalAndTheWindowRestartsAfterOne()
        {
            var stats = new TopicPublishStats { ReportIntervalSeconds = 10 };
            var start = Stopwatch.GetTimestamp();
            stats.RecordEmit("vessel.flight");

            Assert.Null(stats.TryTakeReport(Seconds(start, 5), "none"));
            Assert.NotNull(stats.TryTakeReport(Seconds(start, 10), "none"));

            var quiet = stats.TryTakeReport(Seconds(start, 20), "none");
            Assert.NotNull(quiet);
            Assert.Contains("nothing published", quiet![1]);
        }

        [Fact]
        public void ZeroTurnsRecordingOffAndDropsTheWindow()
        {
            var stats = new TopicPublishStats { ReportIntervalSeconds = 10 };
            stats.RecordEmit("vessel.flight");

            stats.ReportIntervalSeconds = 0;

            Assert.False(stats.Enabled);
            Assert.Null(stats.TryTakeReport(Stopwatch.GetTimestamp() + Stopwatch.Frequency * 100, "none"));
        }
    }
}
