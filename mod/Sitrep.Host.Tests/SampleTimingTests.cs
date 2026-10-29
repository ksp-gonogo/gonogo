using System.Diagnostics;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Runs alone: <c>SampleTiming.Enabled</c> is process-wide, so while one of these
    /// tests has it on, any engine sampling in parallel records into the same lists.
    /// </summary>
    [CollectionDefinition("PerfTelemetry", DisableParallelization = true)]
    public sealed class PerfTelemetryCollection
    {
    }

    [Collection("PerfTelemetry")]
    public sealed class SampleTimingTests
    {
        private static long Ms(double ms) => (long)(ms * Stopwatch.Frequency / 1000.0);

        [Fact]
        public void NothingIsRecordedAndNoLineIsWrittenWhileOff()
        {
            SampleTiming.Enabled = false;
            SampleTiming.Begin();
            using (SampleTiming.Part("a"))
            {
            }
            SampleTiming.Add("b", Ms(5));

            Assert.Null(SampleTiming.Line(10, Ms(5)));
        }

        [Fact]
        public void ALineNamesThePartsSlowestFirstAndSumsARepeatedPart()
        {
            SampleTiming.Enabled = true;
            try
            {
                SampleTiming.Begin();
                SampleTiming.Add("fast", Ms(1));
                SampleTiming.Add("slow", Ms(30));
                SampleTiming.Add("fast", Ms(2));

                var line = SampleTiming.Line(12.5, Ms(40))!;
                Assert.StartsWith("sample-timing ut=12.50 total=40.0ms gc=", line);
                Assert.True(line.IndexOf("slow=30.0") < line.IndexOf("fast=3.0"), line);
            }
            finally
            {
                SampleTiming.Enabled = false;
            }
        }

        [Fact]
        public void APartUnderTheShownFloorIsLeftOut()
        {
            SampleTiming.Enabled = true;
            try
            {
                SampleTiming.Begin();
                SampleTiming.Add("tiny", Ms(0.01));

                Assert.DoesNotContain("tiny", SampleTiming.Line(1, Ms(1)));
            }
            finally
            {
                SampleTiming.Enabled = false;
            }
        }

        [Fact]
        public void BeginForgetsTheLastSamplesParts()
        {
            SampleTiming.Enabled = true;
            try
            {
                SampleTiming.Begin();
                SampleTiming.Add("old", Ms(9));
                SampleTiming.Begin();

                Assert.DoesNotContain("old", SampleTiming.Line(1, Ms(1)));
            }
            finally
            {
                SampleTiming.Enabled = false;
            }
        }

        [Fact]
        public void ALineNamesEveryPartOverTheFloorHoweverMany()
        {
            SampleTiming.Enabled = true;
            try
            {
                SampleTiming.Begin();
                for (var i = 0; i < 30; i++)
                {
                    SampleTiming.Add("part" + i, Ms(1 + i));
                }

                var line = SampleTiming.Line(1, Ms(500))!;
                for (var i = 0; i < 30; i++)
                {
                    Assert.Contains(" part" + i + "=", line);
                }
            }
            finally
            {
                SampleTiming.Enabled = false;
            }
        }

        [Fact]
        public void CountsFollowThePartsSummedAndZeroIncluded()
        {
            SampleTiming.Enabled = true;
            try
            {
                SampleTiming.Begin();
                SampleTiming.Add("landing.horizon", Ms(40));
                SampleTiming.Count("landing.horizon.reads", 2000);
                SampleTiming.Count("landing.grid.reads", 0);
                SampleTiming.Count("landing.horizon.reads", 880);

                var line = SampleTiming.Line(1, Ms(50))!;
                Assert.EndsWith(" #landing.horizon.reads=2880 #landing.grid.reads=0", line);
                Assert.True(line.IndexOf("landing.horizon=40.0") < line.IndexOf('#'), line);
            }
            finally
            {
                SampleTiming.Enabled = false;
            }
        }

        [Fact]
        public void TheSampleAllocationIsCountedWhenNoCollectionRan()
        {
            SampleTiming.Enabled = true;
            try
            {
                var kept = new byte[0];
                string? line = null;
                for (var attempt = 0; attempt < 5 && line == null; attempt++)
                {
                    var collections = System.GC.CollectionCount(0);
                    SampleTiming.Begin();
                    kept = new byte[4 * 1024 * 1024];
                    SampleTiming.MarkSampleAlloc();
                    if (System.GC.CollectionCount(0) == collections)
                    {
                        line = SampleTiming.Line(1, Ms(1));
                    }
                }

                Assert.NotNull(line);
                var at = line!.IndexOf(" #" + SampleTiming.SampleAllocCount + "=", System.StringComparison.Ordinal);
                Assert.True(at >= 0, line);
                var kb = long.Parse(line.Substring(at + SampleTiming.SampleAllocCount.Length + 3).Split(' ')[0]);
                Assert.True(kb >= 4 * 1024 - 64, line);
                System.GC.KeepAlive(kept);
            }
            finally
            {
                SampleTiming.Enabled = false;
            }
        }

        [Fact]
        public void NoCountIsRecordedWhileOff()
        {
            SampleTiming.Enabled = false;
            SampleTiming.Begin();
            SampleTiming.Count("landing.grid.reads", 576);
            SampleTiming.MarkSampleAlloc();
            SampleTiming.Enabled = true;
            try
            {
                Assert.DoesNotContain("#", SampleTiming.Line(1, Ms(1)));
            }
            finally
            {
                SampleTiming.Enabled = false;
            }
        }
    }
}
