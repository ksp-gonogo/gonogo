using System;
using System.IO;
using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    public sealed class PerfReportTests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "perf-report-" + Guid.NewGuid().ToString("N"));

        public void Dispose()
        {
            if (Directory.Exists(_dir))
            {
                Directory.Delete(_dir, recursive: true);
            }
        }

        [Fact]
        public void NothingIsWrittenWhileOff()
        {
            var path = Path.Combine(_dir, "PluginData", "perf-telemetry.jsonl");
            var file = new PerfReportFile(path);

            Assert.False(file.Append(DateTime.UtcNow, "\"frames\":1"));

            Assert.False(File.Exists(path));
            Assert.False(Directory.Exists(_dir));
        }

        [Fact]
        public void OneLinePerAppendWhileOn()
        {
            var path = Path.Combine(_dir, "PluginData", "perf-telemetry.jsonl");
            var file = new PerfReportFile(path) { Enabled = true };

            Assert.True(file.Append(new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc), "\"frames\":1"));
            Assert.True(file.Append(DateTime.UtcNow, "\"frames\":2"));

            var lines = File.ReadAllLines(path);
            Assert.Equal(2, lines.Length);
            Assert.StartsWith("{\"time\":\"2026-01-02T03:04:05", lines[0]);
            Assert.EndsWith("\"frames\":1}", lines[0]);
        }

        [Fact]
        public void CollectionsAndWorstFramesAreCountedPerInterval()
        {
            var stats = new PerfFrameStats();
            stats.Sample(10, 2, 1, 16, 1000);
            stats.Sample(10, 2, 1, 40, 1000);
            stats.Sample(11, 2, 1, 25, 2000);
            stats.Sample(12, 3, 1, 90, 3000);

            Assert.Equal(
                "\"frames\":4,\"worstFrameMs\":90,\"worstGcFrameMs\":90,\"gc\":{\"gen0\":2,\"gen1\":1,\"gen2\":0},\"monoHeapBytes\":3000",
                stats.TakeIntervalJson());

            stats.Sample(12, 3, 1, 10, 3000);
            Assert.Equal(
                "\"frames\":1,\"worstFrameMs\":10,\"worstGcFrameMs\":0,\"gc\":{\"gen0\":0,\"gen1\":0,\"gen2\":0},\"monoHeapBytes\":3000",
                stats.TakeIntervalJson());
        }
    }
}
