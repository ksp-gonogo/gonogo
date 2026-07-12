using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// The sub-topic strings a client actually subscribes to are the load-
    /// bearing contract here — an earlier pass published <c>.AltimetryLoRes</c>
    /// (the enum name) while the client subscribes to <c>.1</c> (the numeric
    /// bit), so nothing ever reached it. These lock the numeric convention.
    /// </summary>
    public class ScanChannelsTests
    {
        [Fact]
        public void BodyTypeSubTopicUsesNumericBitNotName()
        {
            Assert.Equal("Kerbin.1", ScanChannels.BodyTypeSubTopic("Kerbin", 1));
            Assert.Equal("Mun.256", ScanChannels.BodyTypeSubTopic("Mun", 256));
        }

        [Fact]
        public void FullConcreteTopicMatchesClientKey()
        {
            // packages/components/src/Scanning/index.tsx subscribes to
            // `scansat.coverage.${bodyName}.${scanType}` — e.g. Kerbin.1.
            Assert.Equal(
                "scansat.coverage.Kerbin.1",
                ScanChannels.CoveragePrefix + ScanChannels.BodyTypeSubTopic("Kerbin", 1));
            Assert.Equal(
                "scansat.mask.Kerbin.256",
                ScanChannels.MaskPrefix + ScanChannels.BodyTypeSubTopic("Kerbin", 256));
        }

        [Fact]
        public void HeightBiomeSubTopicIsBodyOnly()
        {
            Assert.Equal("scansat.height.Mun", ScanChannels.HeightPrefix + ScanChannels.BodySubTopic("Mun"));
            Assert.Equal("scansat.biome.Mun", ScanChannels.BiomePrefix + ScanChannels.BodySubTopic("Mun"));
        }

        [Fact]
        public void ClientScanTypesMatchTheClientSCANTYPEMap()
        {
            // packages/core/src/schemas/telemachus.ts SCAN_TYPE:
            // AltimetryLoRes 1, AltimetryHiRes 2, Biome 8, Anomaly 16,
            // ResourceLoRes 128, ResourceHiRes 256.
            Assert.Equal(new short[] { 1, 2, 8, 16, 128, 256 }, ScanChannels.ClientScanTypes);
        }
    }
}
