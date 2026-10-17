using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class UplinkLogTests
    {
        [Fact]
        public void AnUplinkLineReachesTheInstalledSinkWithItsLevelAndTag()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var lines = new List<(UplinkLogLevel Level, string Tag, string Message)>();
            engine.SetUplinkLog((level, tag, message) => lines.Add((level, tag, message)));

            ((IUplinkHost)engine).Log(UplinkLogLevel.Warn, "kos", "no processors");

            Assert.Equal((UplinkLogLevel.Warn, "kos", "no processors"), Assert.Single(lines));
        }

        [Fact]
        public void ASinkThatThrowsDoesNotReachTheUplink()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetUplinkLog((_, _, _) => throw new System.InvalidOperationException("sink"));

            ((IUplinkHost)engine).Log(UplinkLogLevel.Info, "kos", "loaded");
        }

        [Fact]
        public void WithNoSinkTheLineGoesToConsoleError()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            ((IUplinkHost)engine).Log(UplinkLogLevel.Info, "kos", "loaded");
        }
    }
}
