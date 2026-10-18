using System.Collections.Concurrent;
using System.Linq;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class HostLogLevelTests
    {
        [Fact]
        public void TheUplinkLoadSummaryGoesToTheInfoSink()
        {
            var warnings = new ConcurrentQueue<string>();
            var infos = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(warnings.Enqueue, infos.Enqueue);

            engine.Start();
            try
            {
                engine.RegisterDiscoveredUplinks(Enumerable.Empty<UplinkDiscovery.DiscoveredUplink>());

                Assert.Contains(infos, l => l.Contains("uplinks: 0 loaded"));
                Assert.DoesNotContain(warnings, l => l.Contains("uplinks: 0 loaded"));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void WithoutAnInfoSinkTheInfoLinesStillReachTheSingleSink()
        {
            var lines = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(lines.Enqueue);

            engine.Start();
            try
            {
                engine.RegisterDiscoveredUplinks(Enumerable.Empty<UplinkDiscovery.DiscoveredUplink>());

                Assert.Contains(lines, l => l.Contains("uplinks: 0 loaded"));
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
