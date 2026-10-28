using System.Diagnostics;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
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
    }
}
