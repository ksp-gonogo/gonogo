using Gonogo.KosUplink;
using Xunit;

namespace GonogoKosUplink.Tests
{
    /// <summary>
    /// The <c>kos.processors</c> wire mapping (mirrors
    /// <c>KerbcastCameraEntryBuilderTests</c>'s pattern). Regression coverage
    /// for the "subscribed but no stream-data" bug moved here from
    /// <c>Sitrep.Core.Tests</c>'s deleted <c>KosProcessorInfoWireTests</c> —
    /// as of the kos migration (2026-07-18) the wire shape is asserted
    /// directly on the Builder's Dictionary output rather than round-tripped
    /// through <c>JsonWriter</c>, since JsonWriter no longer has (or needs) a
    /// hardcoded case for the raw POCO.
    /// </summary>
    public class KosProcessorInfoBuilderTests
    {
        [Fact]
        public void MapsEveryValueOntoItsContractKey()
        {
            var entry = KosProcessorInfoBuilder.Build(
                coreId: 7, tag: "mainframe", hasBooted: true,
                bootFilePath: "0:/boot/startup.ks", processorMode: "READY");

            Assert.Equal(7, entry["coreId"]);
            Assert.Equal("mainframe", entry["tag"]);
            Assert.Equal(true, entry["hasBooted"]);
            Assert.Equal("0:/boot/startup.ks", entry["bootFilePath"]);
            Assert.Equal("READY", entry["processorMode"]);
        }

        [Fact]
        public void NullTagAndBootFilePath_TravelAsJsonNull_NotEmptyString()
        {
            var entry = KosProcessorInfoBuilder.Build(
                coreId: 1, tag: null, hasBooted: false, bootFilePath: null, processorMode: "OFF");

            Assert.Null(entry["tag"]);
            Assert.Null(entry["bootFilePath"]);
        }

        [Fact]
        public void EmitsExactlyTheContractsFieldSet()
        {
            var entry = KosProcessorInfoBuilder.Build(1, "a", true, null, "READY");

            var expected = new[] { "coreId", "tag", "hasBooted", "bootFilePath", "processorMode" };
            Assert.Equal(expected.Length, entry.Count);
            foreach (var key in expected)
            {
                Assert.True(entry.ContainsKey(key), $"missing wire key: {key}");
            }
        }
    }
}
