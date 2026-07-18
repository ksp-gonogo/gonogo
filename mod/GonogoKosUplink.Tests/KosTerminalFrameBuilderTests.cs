using Gonogo.KosUplink;
using Xunit;

namespace GonogoKosUplink.Tests
{
    /// <summary>
    /// The <c>kos.terminal.&lt;coreId&gt;</c> wire mapping. The
    /// <c>fullRepaint</c> key is what <c>KosExtension.Ksp.cs</c>'s
    /// <c>ChannelDeclaration.IsKeyframe</c> predicate reads off the flattened
    /// dictionary, so its exact key name/type is load-bearing, not cosmetic.
    /// </summary>
    public class KosTerminalFrameBuilderTests
    {
        [Fact]
        public void MapsEveryValueOntoItsContractKey()
        {
            var entry = KosTerminalFrameBuilder.Build(coreId: 7, chunk: "hello", fullRepaint: true);

            Assert.Equal(7, entry["coreId"]);
            Assert.Equal("hello", entry["chunk"]);
            Assert.Equal(true, entry["fullRepaint"]);
        }

        [Fact]
        public void IncrementalDiffFrame_CarriesFullRepaintFalse()
        {
            var entry = KosTerminalFrameBuilder.Build(7, "diff-chunk", fullRepaint: false);

            Assert.Equal(false, entry["fullRepaint"]);
        }

        [Fact]
        public void EmitsExactlyTheContractsFieldSet()
        {
            var entry = KosTerminalFrameBuilder.Build(7, "x", true);

            var expected = new[] { "coreId", "chunk", "fullRepaint" };
            Assert.Equal(expected.Length, entry.Count);
            foreach (var key in expected)
            {
                Assert.True(entry.ContainsKey(key), $"missing wire key: {key}");
            }
        }
    }
}
